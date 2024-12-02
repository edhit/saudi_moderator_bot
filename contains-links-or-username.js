function containsLinksOrUsernames(input) {
  // Регулярное выражение для поиска ссылок
  const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.com|[^\s]+\.ru)/i;
  // Регулярное выражение для поиска username (@user)
  const usernameRegex = /@\w+/;

  // Проверяем строку на соответствие любому из регулярных выражений
  const hasLink = linkRegex.test(input);
  const hasUsername = usernameRegex.test(input);

  return {
    hasLink,
    hasUsername,
    contains: hasLink || hasUsername, // Общий результат
  };
}

module.exports = { containsLinksOrUsernames }

// Пример использования
// const testString = "Пример текста с ссылкой https://example.com и @username";
// const result = containsLinksOrUsernames(testString);

// console.log(result); 
// Вывод:
// { hasLink: true, hasUsername: true, contains: true }
