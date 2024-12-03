const { Telegraf } = require('telegraf');
const brain = require('brain.js');
const winston = require('./logger');
const fs = require('fs');
const { isLinkPresent } = require('./utils');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Инициализация нейронной сети
const net = new brain.NeuralNetwork();
let trainingData = [];

// Загрузка данных обучения
const loadTrainingData = () => {
  if (fs.existsSync('./src/trainingData.json')) {
    const data = JSON.parse(fs.readFileSync('./src/trainingData.json'));
    trainingData = data;
    if (data.length > 0) net.train(data);
  }
};

// Сохранение данных обучения
const saveTrainingData = () => {
  fs.writeFileSync('./src/trainingData.json', JSON.stringify(trainingData, null, 2));
};

// Загрузка данных при запуске
loadTrainingData();

// Переменные для подсчета
let trainingCount = trainingData.length;
const trainingGoal = 1000;

// Проверка и обучение
const reviewMessage = async (ctx, message) => {
  const messageText = message.text || '';
  const groupId = message.chat.id;
  const userId = message.from.id;

  // Отправляем сообщение на модерацию
  const modMessage = await ctx.telegram.sendMessage(process.env.MODERATOR_CHAT_ID, `Подходит это сообщение?\n\n"${messageText}"`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Да', callback_data: `approve:${userId}:${groupId}:${message.message_id}` },
          { text: 'Нет', callback_data: `reject:${userId}:${groupId}:${message.message_id}` },
        ],
      ],
    },
  });

  winston.info(`Message sent for moderation: ${modMessage.message_id}`);
};

// Обработка сообщений из группы
bot.on('message', async (ctx) => {
  try {
    const message = ctx.message;

    // Проверка, если бот уже обучен
    if (trainingCount >= trainingGoal) {
      const input = { text: message.text || '' };
      const result = net.run(input);

      if (result.appropriate < 0.5) {
        // Удалить неподходящее сообщение
        await ctx.deleteMessage(message.message_id);
        await ctx.telegram.sendMessage(message.from.id, 'Ваше сообщение было удалено как неподходящее.');
        winston.warn(`Inappropriate message deleted: ${message.message_id}`);
        return;
      }
    } else {
      // Отправляем сообщение на модерацию
      await reviewMessage(ctx, message);
    }
  } catch (error) {
    winston.error('Error processing message:', error);
  }
});

// Обработка ответов на модерацию
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    const [action, userId, groupId, messageId] = data.split(':');

    if (action === 'approve' || action === 'reject') {
      const message = await ctx.telegram.getMessage(groupId, messageId);

      // Обновляем данные обучения
      trainingData.push({
        input: { text: message.text || '' },
        output: { appropriate: action === 'approve' ? 1 : 0 },
      });
      saveTrainingData();
      trainingCount++;

      await ctx.answerCbQuery(`Осталось записей до завершения обучения: ${trainingGoal - trainingCount}`);

      if (trainingCount >= trainingGoal) {
        await ctx.telegram.sendMessage(process.env.ADMIN_ID, 'Обучение завершено. Нейросеть теперь может работать автономно.');
        net.train(trainingData); // Обучаем сеть
      }
    }
  } catch (error) {
    winston.error('Error processing callback query:', error);
  }
});
