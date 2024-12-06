const fs = require("fs");
const { Telegraf } = require("telegraf");
const brain = require("brain.js");
const winston = require("./logger");
const { isLinkPresent } = require("./utils");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// JSON файлы
const ai = "./src/trainingData.json";
const database = "./src/database.json";

// Инициализация нейронной сети
const net = new brain.NeuralNetwork();
let trainingData = [];

// Переменная для базы данных
let db;

// Загрузка данных обучения
const loadTrainingData = () => {
  if (fs.existsSync(ai)) {
    try {
      const data = JSON.parse(fs.readFileSync(ai, "utf8"));
      trainingData = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Ошибка загрузки trainingData.json:", error);
      trainingData = [];
    }
  } else {
    trainingData = [];
  }
};

// Сохранение данных обучения
const saveTrainingData = () => {
  try {
    fs.writeFileSync(ai, JSON.stringify(trainingData, null, 2));
  } catch (error) {
    console.error("Ошибка сохранения trainingData.json:", error);
  }
};

// Загружаем базу данных
const loadDatabase = () => {
  try {
    if (!fs.existsSync(database)) {
      fs.writeFileSync(
        database,
        JSON.stringify({
          admin: null,
          moderator: null,
          group: null,
          moderate: "off",
        }),
      );
    }
    db = JSON.parse(fs.readFileSync(database, "utf-8"));
  } catch (err) {
    console.error("Ошибка при чтении базы данных:", err);
  }
};

// Сохраняем базу данных
const saveDatabase = (data) => {
  try {
    fs.writeFileSync(database, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Ошибка при сохранении базы данных:", err);
  }
};

// Функция добавления/обновления данных
const addOrUpdateTrainingData = (messageId, input, output) => {
  const existingRecordIndex = trainingData.findIndex(
    (record) => record.messageId === messageId,
  );

  if (existingRecordIndex > -1) {
    trainingData[existingRecordIndex] = { messageId, input, output };
  } else {
    trainingData.push({ messageId, input, output });
    trainingCount++;
  }

  saveTrainingData();
};

// Функция для динамического расчета стоимости рекламы
function calculateAdPrice(membersCount) {
  const minPrice = 10; // Минимальная цена
  const maxPrice = 400; // Максимальная цена
  const minMembers = 2000; // Минимальное количество участников
  const maxMembers = 200000; // Максимальное количество участников

  if (membersCount <= minMembers) return minPrice; // Если подписчиков меньше 2000
  if (membersCount >= maxMembers) return maxPrice; // Если подписчиков больше 200000

  // Линейная интерполяция
  return (
    minPrice +
    (maxPrice - minPrice) * ((membersCount - minMembers) / (maxMembers - minMembers))
  ).toFixed(2);
}

// Загрузка данных при запуске
loadTrainingData();
loadDatabase();

// Переменные для подсчета
let trainingCount = trainingData.length;
const trainingGoal = 1000;

// Проверка прав доступа
const isAdmin = (ctx, db) => ctx.from.id === db.admin;
const isModerator = (ctx, db) => ctx.from.id === db.moderator;

// Форматирование сообщений
const formatMessage = (text) => `⚙️ *Управление ботом*\n\n${text}`;
const sendError = (ctx, error) => ctx.reply(`❌ Ошибка: ${error}`);

// Проверка и обучение
const reviewMessage = async (ctx, message) => {
  const messageText = message.text || "";
  // const groupId = message.chat.id;
  // const userId = message.from.id;

  // Отправляем сообщение на модерацию
  const modMessage = await ctx.telegram.sendMessage(
    db.moderator,
    `Подходит это сообщение?\n\n${messageText}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Да", callback_data: `approve:${message.message_id}` },
            { text: "Нет", callback_data: `reject:${message.message_id}` },
          ],
        ],
      },
    },
  );

  winston.info(`Message sent for moderation: ${modMessage.message_id}`);
};

// Middleware для проверки, что чат личный
const privateChatMiddleware = async (ctx, next) => {
  const chatType = ctx.chat?.type;

  if (chatType === "private") {
    // Если чат личный, продолжаем обработку
    await next();
  } else {
    // Если чат не личный, отправляем сообщение и завершаем обработку
    // ctx.reply('❌ Эта команда доступна только в личных чатах с ботом.');
  }
};

// Обработка команды /start
bot.start(privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!db.admin) {
      db.admin = ctx.from.id;
      db.moderator = ctx.from.id;
      saveDatabase(db);
      return ctx.replyWithMarkdown(
        formatMessage("Вы назначены администратором и модератором бота!")
      );
    }

    if (isAdmin(ctx, db) || isModerator(ctx, db)) {
      return ctx.replyWithMarkdown(
        formatMessage(
          "/help — Показать команды",
        ));
    }

    return;
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда /info для получения информации из базы
bot.command("info", privateChatMiddleware, async (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db))
      return ctx.reply("🤖 Эта команда доступена только для администратора.");

    // const memberCount = await ctx.telegram.getChatMembersCount(Number(db.group));

    // Формируем сообщение с информацией из базы
    const infoMessage = `
  📋 *Информация о настройках бота:*
  👤 *Администратор:* ${db.admin || "Не указан"}
  🛡️ *Модератор:* ${db.moderator || "Не указан"}
  👥 *Группа:* ${db.group || "Не указана"}
  ⚙️ *Модерация:* ${db.moderate || "Не указана"}
  🧠 *Обучение:* ${trainingCount} из ${trainingGoal}
    `.trim();

    ctx.replyWithMarkdown(infoMessage);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для удаление данных обучения (только для администратора)
bot.command("clear", privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db))
      return ctx.reply("🤖 Эта команда доступена только для администратора.");
      
    trainingData = []
    trainingCount = trainingData.length
    
    saveTrainingData();

    ctx.reply(`✅ Данные для обучения нейросети удалены`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для показа цены рекламы
bot.command('price', privateChatMiddleware, async (ctx) => {
    try {
      if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");
  
      if (!isAdmin(ctx, db) && !isModerator(ctx, db))
        return ctx.reply(
          "🤖 Эта команда доступена только для администратора и модератора.",
        );
  

    // Получаем количество участников группы
    const membersCount = await ctx.telegram.getChatMembersCount(ctx.chat.id);

    // if (membersCount <= 2000) return ctx.reply('💰 Стоимость рекламы расчитывается от 2000 участников группы')

    let moderator = ''
    if (ctx.from.id === db.moderator) moderator = `📩 Для заказа рекламы свяжитесь с ${(ctx.from.username) ? '@' + ctx.from.username : '"ИМЯ ПОЛЬЗОВАТЕЛЯ НЕ УКАЗАНО"'}`
    // Расчет стоимости рекламы
    const price = calculateAdPrice(membersCount);

    // Формирование сообщения
    const message = `
💰 **Цена рекламы в группе:**
- Количество участников: ${membersCount}
- Стоимость рекламы: *$${price}*

${moderator}
    `;
    ctx.replyWithMarkdown(message);
  } catch (error) {
    logger.error('Failed to calculate ad price: ', error);
    ctx.reply('❌ Произошла ошибка при расчете стоимости рекламы.');
  }
});

// Команда для изменения админа (только для администратора)
bot.command("admin", privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db))
      return ctx.reply("🤖 Эта команда доступена только для администратора.");

    const admin = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(admin))
      return ctx.reply(
        "❌ Укажите ID пользователя для назначения админа.",
      );

    db.admin = admin;
    saveDatabase(db);
    ctx.reply(`✅ Админ изменён на ID: ${admin}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения модератора (только для администратора)
bot.command("moderator", privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db))
      return ctx.reply("🤖 Эта команда доступена только для администратора.");

    const newModeratorId = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(newModeratorId))
      return ctx.reply(
        "❌ Укажите ID пользователя для назначения модератором.",
      );

    db.moderator = newModeratorId;
    saveDatabase(db);
    ctx.reply(`✅ Модератор изменён на ID: ${newModeratorId}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения группы (только для администратора)
bot.command("group", privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db))
      return ctx.reply("🤖 Эта команда доступена только для администратора.");

    const newGroupId = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(newGroupId))
      return ctx.reply("❌ Укажите ID группы для управления.");

    db.group = newGroupId;
    saveDatabase(db);
    ctx.reply(`✅ Группа изменена на ID: ${newGroupId}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения состояния модерации (администратор и модератор)
bot.command("moderate", privateChatMiddleware, (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db) && !isModerator(ctx, db))
      return ctx.reply(
        "🤖 Эта команда доступена только для администратора и модератора.",
      );

    const state = ctx.message.text.split(" ")[1];
    if (!["on", "off"].includes(state))
      return ctx.reply("❌ Укажите 'on' или 'off'.");

    db.moderate = state;
    saveDatabase(db);
    ctx.reply(
      `✅ Состояние модерации изменено на: ${state === "on" ? "Включено" : "Выключено"}`,
    );
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда /help для администратора и модератора
bot.command("help", privateChatMiddleware, (ctx) => {
  if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

  if (!isAdmin(ctx, db) && !isModerator(ctx, db))
    return ctx.reply(
      "🤖 Эта команда доступена только для администратора и модератора.",
    );

  const helpMessage = `
⚙️ *Доступные команды:*

👑 *Администратор:*
/admin [ID] - Назначить нового админа.
/moderator [ID] - Назначить нового модератора.
/group [ID] - Установить группу для управления.
/moderate [on|off] - Включить или отключить модерацию группы.
/price - Цена за рекламу
/help - Показать список доступных команд.
/info - Показать настройки
.clear - Удалить данные обучения

🛡️ *Модератор:*
/moderate [on|off] - Включить или отключить модерацию группы.
/price - Цена за рекламу
/help - Показать список доступных команд.

📜 *Описание:*
- ID пользователя или группы можно найти через Telegram (например, в настройках).
- Команда /moderate [on|off] включает или отключает модерацию сообщений в указанной группе.

💡 Используйте команды с осторожностью, так как изменения вступают в силу сразу!
  `;

  ctx.replyWithMarkdown(formatMessage(helpMessage));
});

// Обработка ответов на модерацию
bot.on("callback_query", privateChatMiddleware, async (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db) && !isModerator(ctx, db))
      return ctx.reply(
        "🤖 Эта команда доступена только для администратора и модератора.",
      );

    const data = ctx.callbackQuery.data;
    const [action, messageId] = data.split(":");

    if (action === "approve" || action === "reject") {
      const message = ctx.callbackQuery.message.text.replace(
        "Подходит это сообщение?\n\n",
        "",
      ).replace(/\s+/g, ' ').trim();

      addOrUpdateTrainingData(
        messageId + '_' + ctx.from.id,
        { text: message || "" },
        { appropriate: action === "approve" ? 1 : 0 },
      );

      await ctx.editMessageText(ctx.callbackQuery.message.text, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: action === "approve" ? "✅ Да" : "Да",
                callback_data: `approve:${messageId}`,
              },
              {
                text: action === "reject" ? "✅ Нет" : "Нет",
                callback_data: `reject:${messageId}`,
              },
            ],
          ],
        },
      }); // Обновляем кнопки
      await ctx.answerCbQuery(
        `Осталось записей до завершения обучения: ${trainingGoal - trainingCount}`,
      );

      if (trainingCount >= trainingGoal) {
        await ctx.reply(
          "Обучение завершено. Нейросеть теперь может работать автономно.",
        );
        net.train(trainingData); // Обучаем сеть
      }
    }
  } catch (error) {
    winston.error("Error processing callback query:", error);
  }
});

// Обработка сообщений из группы
bot.on("message", async (ctx) => {
  try {
    if (!db) return;
    // ctx.telegram.sendMessage(db.admin, "Не удалось загрузить базу данных.");
    const chatId = ctx.chat.id;
    const fromId = ctx.from.id;
    const message = ctx.message;

    if (Number(chatId) !== Number(db.group)) {
      if (Number(fromId) !== Number(db.moderator)) {
        return;
      }
    } else if (Number(chatId) === Number(db.group)) {
      if (Number(fromId) === Number(db.moderator)) {
        return ctx.telegram.sendMessage(db.admin, `⭐️ #MODERATOR\n\n${message.text}\n\nhttps://t.me/c/${String(chatId).slice(4)}/${message.message_id}`)
      }
    }

    if ((message.text === undefined) && (db.moderate === "on")) return ctx.deleteMessage(message.message_id);

    // Проверка, если бот уже обучен
    if (trainingCount >= trainingGoal) {
      const input = { text: message.text.replace(/\s+/g, ' ').trim() || "" };
      const result = net.run(input);
      const username =
        `@${ctx.message.from.username}, объявление ` || "Объявление";

      if (
        (result.appropriate < 0.5 || isLinkPresent(message.text)) &&
        db.moderate === "on"
      ) {
        // Удалить неподходящее сообщение
        await ctx.deleteMessage(message.message_id);
        // await ctx.telegram.sendMessage(message.from.id,
        await ctx.reply(
          `${username}было удалено, так как не относиться к теме группы.`,
        );
        winston.warn(`Inappropriate message deleted: ${message.message_id}`);
        return;
      }
    } else {
      // Отправляем сообщение на модерацию
      await reviewMessage(ctx, message);
    }
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Запуск бота
bot.launch().then(() => {
  console.log("Бот запущен!");
});

// Обработка ошибок
bot.catch((err) => {
  console.error("Произошла ошибка:", err);
});

// Завершение работы
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
