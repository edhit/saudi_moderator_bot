function cosineSimilarity(text1, text2) {
    // Функция для токенизации текста
    function tokenize(text) {
        return text
            .toLowerCase()                // Приводим текст к нижнему регистру
            .replace(/[^\w\s]/g, '')      // Убираем знаки препинания
            .split(/\s+/);                // Разделяем текст на слова
    }

    // Создаём частотный словарь
    function termFrequency(tokens) {
        const freqMap = {};
        tokens.forEach((token) => {
            freqMap[token] = (freqMap[token] || 0) + 1;
        });
        return freqMap;
    }

    // Генерируем общий набор уникальных слов
    function createVectorSpace(freqMap1, freqMap2) {
        const uniqueWords = new Set([...Object.keys(freqMap1), ...Object.keys(freqMap2)]);
        const vector1 = [];
        const vector2 = [];

        uniqueWords.forEach((word) => {
            vector1.push(freqMap1[word] || 0);
            vector2.push(freqMap2[word] || 0);
        });

        return [vector1, vector2];
    }

    // Вычисление скалярного произведения
    function dotProduct(vector1, vector2) {
        return vector1.reduce((sum, value, i) => sum + value * vector2[i], 0);
    }

    // Вычисление длины вектора
    function magnitude(vector) {
        return Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
    }

    // Токенизация и создание частотных словарей
    const tokens1 = tokenize(text1);
    const tokens2 = tokenize(text2);

    const freqMap1 = termFrequency(tokens1);
    const freqMap2 = termFrequency(tokens2);

    // Генерация векторов и вычисление косинусного сходства
    const [vector1, vector2] = createVectorSpace(freqMap1, freqMap2);
    const dotProd = dotProduct(vector1, vector2);
    const magnitude1 = magnitude(vector1);
    const magnitude2 = magnitude(vector2);

    // Возвращаем косинусное сходство (или 0, если один из векторов пуст)
    return magnitude1 && magnitude2 ? dotProd / (magnitude1 * magnitude2) : 0;
}

module.exports = { cosineSimilarity }
