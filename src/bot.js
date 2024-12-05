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
          moderate: "no",
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

  if (chatType === 'private') {
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
      return ctx.reply(
        formatMessage("Вы назначены администратором и модератором бота!"),
        { parse_mode: "Markdown" },
      );
    }

    if (isAdmin(ctx, db) || isModerator(ctx, db)) {
      return ctx.reply(
        formatMessage(
          "Доступные команды:\n\n/admin — Управление ботом.\n/moderator — Назначение модератора.\n/group — Управление группой.\n/help - Инструкция бота",
        ),
        { parse_mode: "Markdown" },
      );
    }

    return ctx.reply(
      "🤖 Этот бот доступен только для администратора и модератора.",
    );
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения модератора (только для администратора)
bot.command(privateChatMiddleware, "moderator", (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db)) return;

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
bot.command(privateChatMiddleware, "group", (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db)) return;

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
bot.command(privateChatMiddleware, "moderate", (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db) && !isModerator(ctx, db)) return;

    const state = ctx.message.text.split(" ")[1];
    if (!["yes", "no"].includes(state))
      return ctx.reply("❌ Укажите 'yes' или 'no'.");

    db.moderate = state;
    saveDatabase(db);
    ctx.reply(
      `✅ Состояние модерации изменено на: ${state === "yes" ? "Включено" : "Выключено"}`,
    );
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда /help для администратора и модератора
bot.command(privateChatMiddleware, "help", (ctx) => {
  if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

  if (!isAdmin(ctx, db) && !isModerator(ctx, db)) return;

  const helpMessage = `
⚙️ *Доступные команды:*

👑 *Администратор:*
/moderator [ID] - Назначить нового модератора.
/group [ID] - Установить группу для управления.
/moderate [yes|no] - Включить или отключить модерацию группы.
/help - Показать список доступных команд.

🛡️ *Модератор:*
/moderate [yes|no] - Включить или отключить модерацию группы.
/help - Показать список доступных команд.

📜 *Описание:*
- ID пользователя или группы можно найти через Telegram (например, в настройках).
- Команда /moderate [yes|no] включает или отключает модерацию сообщений в указанной группе.

💡 Используйте команды с осторожностью, так как изменения вступают в силу сразу!
  `;

  ctx.reply(formatMessage(helpMessage), { parse_mode: "Markdown" });
});

// Обработка ответов на модерацию
bot.on(privateChatMiddleware, "callback_query", async (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!isAdmin(ctx, db) && !isModerator(ctx, db)) return;

    const data = ctx.callbackQuery.data;
    const [action, messageId] = data.split(":");

    if (action === "approve" || action === "reject") {
      const message = ctx.callbackQuery.message.text.replace(
        "Подходит это сообщение?\n\n",
        "",
      );

      addOrUpdateTrainingData(
        messageId,
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
        await ctx.telegram.sendMessage(
          db.moderator,
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

    if (Number(chatId) !== Number(process.env.GROUP_ID)) {
      if (Number(chatId) !== Number(process.env.MODERATOR_CHAT_ID)) {
        return;
      }
    }

    const message = ctx.message;

    // Проверка, если бот уже обучен
    if (trainingCount >= trainingGoal) {
      const input = { text: message.text || "" };
      const result = net.run(input);
      const username =
        `@${ctx.message.from.username}, объявление ` || "Объявление";

      if (
        (result.appropriate < 0.5 || isLinkPresent(message.text)) &&
        db.moderate === "yes"
      ) {
        // Удалить неподходящее сообщение
        await ctx.deleteMessage(message.message_id);
        await ctx.telegram.sendMessage(
          message.from.id,
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
