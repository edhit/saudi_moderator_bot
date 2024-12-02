require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const brain = require('brain.js');
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const winston = require('winston');

// Конфигурация из .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const GROUP_ID = process.env.GROUP_ID;
const REVIEWERS_API = process.env.REVIEWERS_API;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const THRESHOLD = 1000;
const MODEL_FILE = './model.json';

// Инициализация логгера
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' }),
  ],
});

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Подключение к MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true }).catch((err) => {
  logger.error(`Ошибка подключения к MongoDB: ${err.message}`);
});
const db = mongoose.connection;
db.on('error', (err) => logger.error(`Ошибка MongoDB: ${err.message}`));
db.once('open', () => logger.info('Подключение к MongoDB установлено.'));

// Модель для хранения данных обучения
const trainingSchema = new mongoose.Schema({
  text: String,
  features: Object,
  appropriate: Boolean,
});
const Training = mongoose.model('Training', trainingSchema);

// Инициализация нейросети
const net = new brain.NeuralNetwork({
  hiddenLayers: [16, 16],
  activation: 'sigmoid',
});

// Загрузка модели
if (fs.existsSync(MODEL_FILE)) {
  const savedModel = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  net.fromJSON(savedModel);
  logger.info('Модель загружена из файла.');
}

// Нормализация текста и извлечение признаков
function extractFeatures(text) {
  const normalized = text.toLowerCase().replace(/[^a-zа-я0-9\s]/gi, '').trim();
  return {
    text: normalized,
    length: normalized.length,
    wordCount: normalized.split(/\s+/).length,
    hasLinks: /\bhttp\b|\bwww\b/.test(text) ? 1 : 0,
    hasCaps: /[A-ZА-Я]/.test(text) ? 1 : 0,
  };
}

// Функция для обучения модели
async function trainModel() {
  const trainingData = await Training.find();
  if (trainingData.length >= THRESHOLD) {
    logger.info('Начинаем обучение модели...');
    const formattedData = trainingData.map((entry) => ({
      input: entry.features,
      output: { appropriate: entry.appropriate ? 1 : 0 },
    }));
    net.train(formattedData, {
      iterations: 3000,
      log: true,
      learningRate: 0.005,
    });
    fs.writeFileSync(MODEL_FILE, JSON.stringify(net.toJSON()));
    logger.info('Модель обучена и сохранена.');
    bot.telegram.sendMessage(ADMIN_ID, 'Модель успешно обучена.');
  }
}

// Получение списка рецензентов
async function getReviewers() {
  try {
    const response = await axios.get(REVIEWERS_API);
    if (Array.isArray(response.data)) {
      return response.data.map((reviewer) => parseInt(reviewer.id, 10));
    }
    logger.warn('API рецензентов вернуло некорректный формат.');
    return [];
  } catch (err) {
    logger.error(`Ошибка получения списка рецензентов: ${err.message}`);
    return [];
  }
}

// Функция для проверки наличия ссылок и имени пользователя
function containsProhibitedContent(text, username) {
  const linkPattern = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
  const usernamePattern = new RegExp(`\\b${username}\\b`, 'i');
  return linkPattern.test(text) || usernamePattern.test(text);
}

// Обработка сообщений из группы
bot.on('message', async (ctx) => {
  if (ctx.chat.id === Number(GROUP_ID)) {
    const messageText = ctx.message.text;
    const username = ctx.message.from.username || 'unknown_user';
    const features = extractFeatures(messageText);

    const trainingDataCount = await Training.countDocuments();
    if (trainingDataCount >= THRESHOLD) {
      // Проверяем сообщение с помощью модели
      const result = net.run(features);

      // Если сообщение не соответствует, проверяем дополнительные правила
      if (result.appropriate < 0.5 || containsProhibitedContent(messageText, username)) {
        await ctx.deleteMessage();
        await ctx.reply(
          `Ваше сообщение нарушает правила группы. Пожалуйста, избегайте использования ссылок или упоминаний имени пользователя.\n\nВаше сообщение: "${messageText}"`,
          { reply_to_message_id: ctx.message.message_id }
        );
        logger.info(`Удалено сообщение: "${messageText}" от пользователя @${username}`);
      }
    } else {
      // Рассылаем сообщение рецензентам
      const reviewers = await getReviewers();
      for (const reviewerId of reviewers) {
        try {
          await ctx.telegram.sendMessage(
            reviewerId,
            `Сообщение: "${messageText}"\nЭто сообщение подходит?`,
            Markup.inlineKeyboard([
              Markup.button.callback('Да', `approve:${ctx.message.message_id}`),
              Markup.button.callback('Нет', `reject:${ctx.message.message_id}`),
            ])
          );
        } catch (err) {
          logger.error(`Ошибка отправки рецензенту ${reviewerId}: ${err.message}`);
        }
      }
    }
  }
});

// Обработка ответов рецензентов
bot.on('callback_query', async (ctx) => {
  const [action, messageId] = ctx.callbackQuery.data.split(':');
  const messageText = ctx.callbackQuery.message.text.split('\n')[0].replace('Сообщение: "', '').replace('"', '');
  const isAppropriate = action === 'approve';
  const features = extractFeatures(messageText);

  const trainingEntry = new Training({
    text: messageText,
    features,
    appropriate: isAppropriate,
  });
  await trainingEntry.save();

  logger.info(`Добавлена обучающая запись: "${messageText}" (${isAppropriate ? 'Да' : 'Нет'})`);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `${ctx.callbackQuery.message.text}\nВаш ответ: ${isAppropriate ? 'Да' : 'Нет'}`
  );

  // Обучаем модель
  await trainModel();
});

// Команды для администратора
bot.command('stats', async (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    const trainingDataCount = await Training.countDocuments();
    ctx.reply(`Текущая статистика:\nОбучающих данных: ${trainingDataCount}\nПорог: ${THRESHOLD}`);
  }
});

bot.command('reset', async (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    await Training.deleteMany({});
    if (fs.existsSync(MODEL_FILE)) {
      fs.unlinkSync(MODEL_FILE);
    }
    ctx.reply('Обучающие данные и модель сброшены.');
    logger.info('Обучающие данные и модель сброшены.');
  }
});

// Запуск бота
bot.launch().then(() => {
  logger.info('Бот запущен.');
});

// Завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));