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
      winston.error("Ошибка загрузки trainingData.json:", error);
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
    winston.error("Ошибка сохранения trainingData.json:", error);
  }
};

// Загружаем базу данных
const loadDatabase = () => {
  try {
    if (!fs.existsSync(database)) {
      fs.writeFileSync(
        database,
        JSON.stringify({
          bot_id: null,
          bot_name: null,
          admin: null,
          moderator: null,
          group: null,
          moderate: "off",
          train: false,
        }),
      );
    }
    db = JSON.parse(fs.readFileSync(database, "utf-8"));
  } catch (err) {
    winston.error("Ошибка при чтении базы данных:", err);
  }
};

// Сохраняем базу данных
const saveDatabase = (data) => {
  try {
    fs.writeFileSync(database, JSON.stringify(data, null, 2));
  } catch (err) {
    winston.error("Ошибка при сохранении базы данных:", err);
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
  const maxPrice = 600; // Максимальная цена
  const minMembers = 1000; // Минимальное количество участников
  const maxMembers = 200000; // Максимальное количество участников

  if (membersCount <= minMembers) return minPrice; // Если подписчиков меньше 1000
  if (membersCount >= maxMembers) return maxPrice; // Если подписчиков больше 200000

  // Линейная интерполяция
  return (
    minPrice +
    (maxPrice - minPrice) *
      ((membersCount - minMembers) / (maxMembers - minMembers))
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
  try {
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
  } catch (error) {
    winston.error("Error processing message:", error);
  }
};

// Middlewares
const privateChatMiddleware = async (ctx, next) => {
  const chatType = ctx.chat?.type;

  if (chatType === "private") {
    // Если чат личный, продолжаем обработку
    await next();
  } else return;
};

const fromGroupChatMiddleware = async (ctx, next) => {
  if (!db) return;

  if (Number(chatId) === Number(db.group)) {
    // Если чат личный, продолжаем обработку
    await next();
  } else return;
};

const isAdminMiddleware = async (ctx, next) => {
  if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

  if (!isAdmin(ctx, db)) return; //ctx.reply("🤖 Эта команда доступена только для администратора.");

  await next();
};

const isAdminAndModeratorMiddleware = async (ctx, next) => {
  if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

  if (!isAdmin(ctx, db) && !isModerator(ctx, db)) return; //ctx.reply("🤖 Эта команда доступена только для администратора и модератора.");

  await next();
};

// Обработка команды /start
bot.start(privateChatMiddleware, async (ctx) => {
  try {
    if (!db) return sendError(ctx, "Не удалось загрузить базу данных.");

    if (!db.admin) {
      const botInfo = await bot.telegram.getMe(); // Получаем информацию о боте
      const botId = botInfo.id; // ID бота
      const botName = botInfo.username;

      db.bot_id = botId;
      db.bot_name = botName;
      db.admin = ctx.from.id;
      db.moderator = ctx.from.id;
      saveDatabase(db);
      return ctx.replyWithMarkdown(
        formatMessage("Вы назначены администратором и модератором бота!"),
      );
    }

    if (isAdmin(ctx, db) || isModerator(ctx, db)) {
      return ctx.replyWithMarkdown(
        formatMessage(`Статус: ${isAdmin(ctx, db) ? "ADMIN" : "MODERATOR"}
/help — Показать команды`),
      );
    }

    return;
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда /info для получения информации из базы
bot.command("info", privateChatMiddleware, isAdminMiddleware, async (ctx) => {
  try {
    // const memberCount = await ctx.telegram.getChatMembersCount(Number(db.group));

    // Формируем сообщение с информацией из базы
    const infoMessage = `
  📋 *Информация о настройках бота:*
  🤖 *Бот:* ${db.bot_id || "Не указан"}
  👤 *Администратор:* ${db.admin || "Не указан"}
  🛡️ *Модератор:* ${db.moderator || "Не указан"}
  👥 *Группа:* ${db.group || "Не указана"}

  ⚙️ *Модерация:* ${db.moderate || "Не указана"}
  🧠 *Обучение:* ${trainingCount} из ${trainingGoal}
    `.trim();

    return ctx.replyWithMarkdown(infoMessage);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для сброса всех данных
bot.command("aezakmi", privateChatMiddleware, isAdminMiddleware, (ctx) => {
  try {
    trainingData = [];
    trainingCount = trainingData.length;

    db = {
      bot_id: null,
      bot_name: null,
      admin: null,
      moderator: null,
      group: null,
      moderate: "off",
      train: false,
    };

    saveTrainingData();
    saveDatabase(db);

    loadTrainingData();
    loadDatabase();

    return ctx.reply(`✅ Все данные были сброшены. /start`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для показа цены рекламы
bot.command(
  "price",
  privateChatMiddleware,
  isAdminAndModeratorMiddleware,
  async (ctx) => {
    try {
      // Получаем количество участников группы
      const membersCount = await ctx.telegram.getChatMembersCount(ctx.chat.id);

      if (membersCount <= 1000)
        return ctx.reply(
          "💰 Стоимость рекламы расчитывается от 1000 участников группы",
        );

      let moderator = "";
      if (ctx.from.id === db.moderator)
        moderator = `📩 Для заказа рекламы свяжитесь с ${
          ctx.from.username
            ? "@" + ctx.from.username
            : '"ИМЯ ПОЛЬЗОВАТЕЛЯ НЕ УКАЗАНО"'
        }`;
      // Расчет стоимости рекламы
      const price = calculateAdPrice(membersCount);

      // Формирование сообщения
      const message = `
💰 Цена рекламы в группе:
- Количество участников: ${membersCount}
- Стоимость рекламы: $${price}

${moderator}
    `;
      return ctx.reply(message);
    } catch (error) {
      winston.error("Error processing message:", error);
    }
  },
);

// Команда для изменения админа (только для администратора)
bot.command("admin", privateChatMiddleware, isAdminMiddleware, (ctx) => {
  try {
    const admin = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(admin))
      return ctx.reply("❌ Укажите ID пользователя для назначения админа.");

    db.admin = admin;
    saveDatabase(db);
    return ctx.reply(`✅ Админ изменён на ID: ${admin}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения модератора (только для администратора)
bot.command("moderator", privateChatMiddleware, isAdminMiddleware, (ctx) => {
  try {
    const newModeratorId = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(newModeratorId))
      return ctx.reply(
        "❌ Укажите ID пользователя для назначения модератором.",
      );

    db.moderator = newModeratorId;
    saveDatabase(db);
    return ctx.reply(`✅ Модератор изменён на ID: ${newModeratorId}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения группы (только для администратора)
bot.command("group", privateChatMiddleware, isAdminMiddleware, (ctx) => {
  try {
    const newGroupId = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(newGroupId))
      return ctx.reply("❌ Укажите ID группы для управления.");

    db.group = newGroupId;
    saveDatabase(db);
    return ctx.reply(`✅ Группа изменена на ID: ${newGroupId}`);
  } catch (error) {
    winston.error("Error processing message:", error);
  }
});

// Команда для изменения состояния модерации (администратор и модератор)
bot.command(
  "moderate",
  privateChatMiddleware,
  isAdminAndModeratorMiddleware,
  (ctx) => {
    try {
      const state = ctx.message.text.split(" ")[1];
      if (!["on", "off", "test"].includes(state))
        return ctx.reply("❌ Укажите 'on' или 'off' или 'test'");

      db.moderate = state;
      saveDatabase(db);
      return ctx.reply(
        `✅ Состояние модерации изменено на: ${
          state === "on" ? "Включено" : "Выключено"
        }`,
      );
    } catch (error) {
      winston.error("Error processing message:", error);
    }
  },
);

// Команда /help для администратора и модератора
bot.command(
  "help",
  privateChatMiddleware,
  isAdminAndModeratorMiddleware,
  (ctx) => {
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

🛡️ *Модератор:*
/moderate [on|off] - Включить или отключить модерацию группы.
/price - Цена за рекламу
/help - Показать список доступных команд.

_/moderate test - посмотреть, как проверяет входящие сообщение из группы бот(после обучения)_

📜 *Описание:*
- ID пользователя или группы можно найти через Telegram (например, в настройках).
- Команда /moderate [on|off] включает или отключает модерацию сообщений в указанной группе.

💡 Используйте команды с осторожностью, так как изменения вступают в силу сразу!
  `;

    ctx.replyWithMarkdown(formatMessage(helpMessage));
  },
);

// Обработка ответов на модерацию
bot.on(
  "callback_query",
  privateChatMiddleware,
  isAdminAndModeratorMiddleware,
  async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;
      const [action, messageId] = data.split(":");

      if (action === "approve" || action === "reject") {
        const message = ctx.callbackQuery.message.text
          .replace("Подходит это сообщение?\n\n", "")
          .replace(/\s+/g, " ")
          .trim();

        addOrUpdateTrainingData(
          messageId + "_" + ctx.from.id,
          { text: message || "" },
          { appropriate: action === "approve" ? 1 : 0 },
        );

        if (db.train === true) {
          return ctx.answerCbQuery(`🧠 Обучаение было завершено`);
        }

        try {
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
          }); // Обновляем кнопк
        } catch (error) {}

        await ctx.answerCbQuery(
          `Осталось записей до завершения обучения: ${
            trainingGoal - trainingCount
          }`,
        );

        if (trainingCount >= trainingGoal) {
          db.train = true;
          saveDatabase(db);

          await ctx.reply(
            "Обучение завершено. Нейросеть теперь может работать автономно.",
          );
          net.train(trainingData); // Обучаем сеть
        }
      }
    } catch (error) {
      winston.error("Error processing callback query:", error);
    }
  },
);

async function moderateGroup(ctx) {
  try {
    if (!db) return;
    // ctx.telegram.sendMessage(db.admin, "Не удалось загрузить базу данных.");
    const chatId = ctx.chat.id;
    const fromId = ctx.from.id;
    const message = ctx.message;

    if (
      (!message.text || isLinkPresent(message.text)) &&
      db.moderate === "on" &&
      Number(fromId) !== Number(db.moderator)
    )
      return ctx.deleteMessage(message.message_id);

    if (Number(fromId) === Number(db.moderator)) {
      return ctx.telegram.sendMessage(
        db.admin,
        `⭐️ #message_moderator\n\n${
          message.text
            ? message.text
            : message.caption
              ? message.caption
              : "Текста в сообщении нету. Посмотреть можно по ссылке ниже:"
        }\n\n(Ссылка)[https://t.me/c/${String(chatId).slice(4)}/${message.message_id}]`,
        {
          parse_mode: 'Markdown'
        }
      );
    }
    if (fromId === db.bot_id) {
      return;
    }

    // Проверка, если бот уже обучен
    if (db.train === true) {
      const input = { text: message.text.replace(/\s+/g, " ").trim() || "" };
      const result = net.run(input);
      const username =
        `@${ctx.message.from.username}, объявление ` || "Объявление";

      if (db.moderate === "test") {
        return ctx.replyWithMarkdown(
          `${message.text}
           Схожесть текста: *${result.appropriate * 100} %*
           Наличие ссылок: *${(isLinkPresent(message.text)) ? "Да" : "Нет"}*
        `);
      }

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
}

// Обработка входящих сообщений из группы
bot.on("message", fromGroupChatMiddleware, moderateGroup);

// Обработка измененных сообщений из группы
bot.on("edited_message", fromGroupChatMiddleware, moderateGroup);

// Запуск бота
bot.launch().then(() => {
  winston.error("Произошла ошибка:", err);
});

// Обработка ошибок
bot.catch((err) => {
  winston.error("Произошла ошибка:", err);
});

// Завершение работы
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
