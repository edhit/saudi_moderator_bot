const { exec } = require('child_process');
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
    try {
      const data = JSON.parse(fs.readFileSync('./src/trainingData.json', 'utf8'));
      trainingData = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Ошибка загрузки trainingData.json:', error);
      trainingData = [];
    }
  } else {
    trainingData = [];
  }
};

// Сохранение данных обучения
const saveTrainingData = () => {
  try {
    fs.writeFileSync('./src/trainingData.json', JSON.stringify(trainingData, null, 2));
  } catch (error) {
    console.error('Ошибка сохранения trainingData.json:', error);
  }
};

// Функция добавления/обновления данных
const addOrUpdateTrainingData = (messageId, input, output) => {
  const existingRecordIndex = trainingData.findIndex(
    (record) => record.messageId === messageId
  );

  if (existingRecordIndex > -1) {
    trainingData[existingRecordIndex] = { messageId, input, output };
  } else {
    trainingData.push({ messageId, input, output });
    trainingCount++;

  }

  saveTrainingData();
};

// Загрузка данных при запуске
loadTrainingData();

// Переменные для подсчета
let trainingCount = trainingData.length;
const trainingGoal = 1000;

// Проверка и обучение
const reviewMessage = async (ctx, message) => {
  const messageText = message.text || '';
  // const groupId = message.chat.id;
  // const userId = message.from.id;

  // Отправляем сообщение на модерацию
  const modMessage = await ctx.telegram.sendMessage(process.env.MODERATOR_CHAT_ID, `Подходит это сообщение?\n\n${messageText}`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Да', callback_data: `approve:${message.message_id}` },
          { text: 'Нет', callback_data: `reject:${message.message_id}` },
        ],
      ],
    },  
  });

  winston.info(`Message sent for moderation: ${modMessage.message_id}`);
};

bot.command('ujzbqecfubpjkqu', (ctx) => ctx.reply('🫡'))

bot.command('rasxtdhndjvwtzp', async (ctx) => {
  if (ctx.from.id !== process.env.ADMIN_ID) {
    return ctx.reply('У вас нет прав для выполнения этой команды.');
  }

  try {
    ctx.reply('Запускаю обновление...');
    exec('bash manage.sh update', (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка выполнения скрипта: ${error.message}`);
        ctx.reply(`Ошибка: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Стандартная ошибка: ${stderr}`);
        ctx.reply(`Ошибка: ${stderr}`);
        return;
      }
      ctx.reply(`Скрипт выполнен успешно:\n${stdout}`);
    });
  } catch (error) {
    console.error('Ошибка обработки команды /git:', error);
    ctx.reply('Произошла ошибка при выполнении команды.');
  }
});

// Обработка ответов на модерацию
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    const [action, messageId] = data.split(':');

    if (action === 'approve' || action === 'reject') {
      // const message = await ctx.telegram.getMessage(groupId, messageId);
      const message = ctx.callbackQuery.message.text.replace('Подходит это сообщение?\n\n', '');
      // Обновляем данные обучения
      // trainingData.push({
      //   input: { text: message || '' },
      //   output: { appropriate: action === 'approve' ? 1 : 0 },
      // });
      // saveTrainingData();
      addOrUpdateTrainingData(messageId, { text: message || '' }, { appropriate: action === 'approve' ? 1 : 0 });

      await ctx.editMessageText(ctx.callbackQuery.message.text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: action === 'approve' ? '✅ Да' : 'Да' , callback_data: `approve:${messageId}` },
              { text: action === 'reject' ? '✅ Нет' : 'Нет', callback_data: `reject:${messageId}` },
            ],
          ],
        },  
      }); // Обновляем кнопки
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


// Обработка сообщений из группы
bot.on('message', async (ctx) => {
  try {
    const message = ctx.message;

    // Проверка, если бот уже обучен
    if (trainingCount >= trainingGoal) {
      const input = { text: message.text || '' };
      const result = net.run(input);
      const username = `@${ctx.message.from.username}, объявление ` || 'Объявление' 

      if (result.appropriate < 0.5 || isLinkPresent(message.text)) {
        // Удалить неподходящее сообщение
        await ctx.deleteMessage(message.message_id);
        await ctx.telegram.sendMessage(message.from.id, `${username}было удалено, так как не относиться к теме группы.`);
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

// Запуск бота
bot.launch().then(() => {
  console.log('Бот запущен!');
});
