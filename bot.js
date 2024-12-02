require('dotenv').config();
const { Telegraf } = require('telegraf');
const { containsLinksOrUsernames } = require('./contains-links-or-username');
const { cosineSimilarity } = require('./cosine-similarity');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Укажите ID группы
const TARGET_GROUP_ID = -123456789; // Замените на ID вашей группы

// Пример текста для проверки косинусного сходства
const REFERENCE_TEXT = `السلام عليكم ورحمة الله وبركاته
Продам 2000 SAR за RUB, USDT, EUR
📍 Медина, Мекка, Джидда
💵 Курс: 27.81
🔄 Способ обмена: Перевод
🚚 Доставка: 30 SAR
Ппппр

🚨 Срочно!!!`;

// Обработка всех сообщений
bot.on('message', async (ctx) => {
    try {
        const chatType = ctx.chat.type;
        const messageText = ctx.message.text;

        // Если сообщение пришло из указанной группы
        if (chatType === 'group' || chatType === 'supergroup') {
            if (ctx.chat.id === TARGET_GROUP_ID) {
                await handleMessage(ctx, messageText, 'группы');
            }
        }

        // Если сообщение пришло в личных сообщениях
        if (chatType === 'private') {
            await handleMessage(ctx, messageText, 'личного чата');
        }
    } catch (error) {
        console.error('Ошибка при обработке сообщения:', error);
    }
});

// Функция обработки сообщения
async function handleMessage(ctx, text, source) {
    // Проверка на ссылки и юзернеймы
    const { hasLink, hasUsername, contains } = containsLinksOrUsernames(text);

    if (contains) {
        await ctx.reply(
            `⚠️ Ваше сообщение из ${source} содержит запрещённый контент.\n\n` +
            `- Ссылка: ${hasLink ? 'Да' : 'Нет'}\n` +
            `- Юзернейм: ${hasUsername ? 'Да' : 'Нет'}`
        );
        return;
    }

    // Проверка косинусного сходства
    const similarity = cosineSimilarity(text, REFERENCE_TEXT);
    if (similarity < 0.85) {
        await ctx.reply(
            `⚠️ Ваше сообщение из ${source} сильно отличается от ожидаемого формата.\n` +
            `Похожесть текста: ${(similarity * 100).toFixed(2)}%`
        );
        return;
    }

    // Если всё в порядке
    await ctx.reply(`✅ Ваше сообщение из ${source} соответствует требованиям.${similarity}`);
}

// Запуск бота
bot.launch()
    .then(() => console.log('Бот запущен и готов к работе!'))
    .catch((err) => console.error('Ошибка при запуске бота:', err));

// Остановка gracefully при завершении программы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
