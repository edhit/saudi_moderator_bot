// Проверка на наличие ссылок
const isLinkPresent = (text) => {
  const linkRegex = /(http[s]?:\/\/|www\.|t\.me|wa\.me|@[\w]+)/gi;
  return linkRegex.test(text);
};

module.exports = { isLinkPresent };
