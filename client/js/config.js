// Единая точка конфигурации HelpDesk хоз службы.
// При переезде сайта на другой хост или порт правится только этот файл,
// а в корп-системе — переменная LEGACY_HELPDESK_ORIGINS, иначе запросы
// к :12010 отсечёт CORS.
//
// ВНИМАНИЕ: botToken ниже виден любому посетителю сайта и уже попал в
// git-историю. Токены нужно отозвать в BotFather, а отправку в Telegram
// перенести на бэкенд — корп-система уже умеет уведомлять исполнителей
// сама (notifyTicketAssignees). До этого момента токены остаются здесь,
// иначе группы сантехников, электриков и вентиляции перестанут получать
// заявки.
window.HELPDESK_CONFIG = {
    legacyApiUrl: "http://192.168.101.25:1337",
    corpApiUrl: "http://192.168.101.25:12010",
    corpHelpdeskUrl: "http://192.168.101.25:12010/api/tickets/legacy/submit",
    corpCategoriesUrl: "http://192.168.101.25:12010/api/tickets/legacy/categories",
    telegramApiUrl: "https://api.telegram.org",

    // Раздел каталога → служба, которой уходит заявка. Разделы, заведённые в
    // админке, распознаются по названию; если совпадения нет, заявка идёт
    // только в корп-систему, а старый Strapi и Telegram пропускаются.
    sectionServiceRules: [
        { match: /сантех|plumb/i, service: "santehniks" },
        { match: /электр|electr/i, service: "elektriks" },
        { match: /вентил|кондицион|ventil/i, service: "ventel" },
    ],

    // Службы формы. match сопоставляется с id выбранной радиокнопки.
    services: [
        {
            key: "elektriks",
            match: "elektriks",
            endpoint: "/api/elektriks",
            chatId: -4570318896,
            botToken: "7539134948:AAGSRsFjbn_McxN_jkz3QpyM2EUcua-vK8s",
        },
        {
            key: "santehniks",
            match: "santehniks",
            endpoint: "/api/santehniks",
            chatId: -4548047122,
            botToken: "7525962971:AAEoBGefK4e-PjIeNC24X_KY2u7eQU_rI0s",
        },
        {
            key: "ventel",
            match: "ventel",
            endpoint: "/api/ventilyaczionshhiks",
            chatId: -4587546685,
            botToken: "7525962971:AAEoBGefK4e-PjIeNC24X_KY2u7eQU_rI0s",
        },
    ],

    // Коллекции, из которых собирается статус заявки по номеру телефона.
    // Плотники здесь есть, хотя категории «Плотники» в форме нет —
    // старые заявки должны оставаться видимыми.
    statusEndpoints: [
        "/api/santehniks",
        "/api/plotniks",
        "/api/ventilyaczionshhiks",
        "/api/elektriks",
    ],

    // Телефон: страна фиксирована, человек вводит только национальные
    // 10 цифр — 7XX XXX XX XX.
    phoneCountryCode: "7",
    phoneNationalLength: 10,

    // Поиск заявки. Совпадение ищется по последним цифрам номера, потому что
    // в старых записях код страны записан по-разному: 777…, 7777…, 8777…
    statusMatchDigits: 9,
    searchDebounceMs: 350,

    // Общая для всех служб часть заявки в корп-системе.
    serviceGroupSlug: "engineering",
    departmentKey: "ENGINEERING",
};
