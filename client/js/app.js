document.addEventListener("DOMContentLoaded", function () {
    const config = window.HELPDESK_CONFIG;

    let success = document.querySelector(".success");
    let successImg = document.querySelector(".success__img");
    let checkedOrNot = document.querySelector(".checkedOrNot");
    let radioInput = document.querySelectorAll(".radioInput");
    let inputs = document.querySelectorAll(".main__inputs");
    let textArea = document.querySelector("textarea");
    let btn = document.querySelector(".btn__submit");
    let searchInput = document.querySelector(".main__searchInput");
    let catalog = document.querySelector(".main__catalog");

    // Один ключ на одну заполненную форму: если отправка сорвалась и человек
    // нажал кнопку повторно, корп-система вернёт уже созданную заявку вместо
    // дубля. Новый ключ выдаётся только после успешной отправки.
    let submissionKey = createSubmissionKey();
    let sending = false;
    let searchTimer = null;
    let searchRequestId = 0;

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (sending) {
            return;
        }
        if (!checkInputs(inputs, textArea, checkedOrNot, radioInput)) {
            return;
        }

        let query;
        let legacyCategoryId;
        let service = null;
        radioInput.forEach((item) => {
            if (item.checked) {
                query = item.value;
                legacyCategoryId = item.id;
                service = findService(item.id);
            }
        });

        if (!service) {
            alert("Не удалось определить службу для выбранной категории!");
            return;
        }

        let massage = `<b>Заявка  ${query}</b>\n`;
        massage += `<b>ФИО : ${inputs[1].value}</b>\n`;
        massage += `<b>Отделение : ${inputs[2].value}</b>\n`;
        massage += `<b>Телеофн : ${inputs[0].value}</b>\n`;
        massage += `<b>Комментарий : ${textArea.value}</b>\n`;
        massage += `<b>Запрос : ${query}</b>\n`;

        const legacyPayload = {
            userName: inputs[1].value,
            userPhone: inputs[0].value,
            userSide: inputs[2].value,
            userComment: textArea.value,
            userQuery: query,
            legacyCategoryId,
            legacyEndpoint: service.endpoint,
            serviceGroupSlug: config.serviceGroupSlug,
            departmentKey: config.departmentKey,
            submissionKey,
        };

        setSending(true);

        // allSettled, а не all: недоступность корп-системы или Telegram больше
        // не показывает ошибку по заявке, которая на самом деле создана.
        Promise.allSettled([
            axios.post(`${config.legacyApiUrl}${service.endpoint}`, {
                data: {
                    userName: legacyPayload.userName,
                    userPhone: legacyPayload.userPhone,
                    userSide: legacyPayload.userSide,
                    userComment: legacyPayload.userComment,
                    userQuery: legacyPayload.userQuery,
                },
            }),
            axios.post(config.corpHelpdeskUrl, legacyPayload),
            axios.post(
                `${config.telegramApiUrl}/bot${service.botToken}/sendMessage`,
                {
                    chat_id: service.chatId,
                    parse_mode: "html",
                    text: massage,
                }
            ),
        ])
            .then((results) => {
                const [legacyResult, corpResult, telegramResult] = results;
                logRejected("Старый HelpDesk", legacyResult);
                logRejected("Корп-система", corpResult);
                logRejected("Telegram", telegramResult);

                if (
                    legacyResult.status === "rejected" &&
                    corpResult.status === "rejected"
                ) {
                    alert(
                        "Ошибка при отправке! Заявка не зарегистрирована, попробуйте ещё раз."
                    );
                    return;
                }

                submissionKey = createSubmissionKey();
                inputs.forEach((item) => (item.value = ""));
                textArea.value = "";
                success.style.display = "block";
                successImg.classList.add("successLoadingActive");

                setTimeout(() => {
                    success.style.display = "none";
                    successImg.classList.remove("successLoadingActive");
                }, 3400);

                refreshQueryList();
            })
            .finally(() => {
                setSending(false);
            });
    });

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(refreshQueryList, config.searchDebounceMs);
        });
    }

    function refreshQueryList() {
        if (!searchInput || !catalog) {
            return;
        }

        const phone = searchInput.value.trim();
        if (phone.length < config.searchMinDigits) {
            renderQueryList([]);
            return;
        }

        // Ответы приходят не по порядку: показываем только последний запрос.
        searchRequestId += 1;
        const requestId = searchRequestId;

        searchQueriesByPhone(phone).then((items) => {
            if (requestId === searchRequestId) {
                renderQueryList(items);
            }
        });
    }

    function renderQueryList(items) {
        catalog.innerHTML = "";
        items.forEach((item) => {
            const statusClass = STATUS_CLASS[item.Progress];
            if (statusClass) {
                catalog.appendChild(buildQueryCard(item, statusClass));
            }
        });
    }

    function setSending(value) {
        sending = value;
        btn.disabled = value;
    }

    function findService(categoryId) {
        return (
            config.services.find((item) =>
                String(categoryId).includes(item.match)
            ) || null
        );
    }
});

const STATUS_CLASS = {
    Сделано: "greenDone",
    "в работе": "yellowInWork",
    "Новая заявка": "blueNewQuery",
};

// Карточка собирается через DOM, а не через innerHTML: ФИО и комментарий
// приходят от анонимных отправителей и раньше выполнялись как разметка.
function buildQueryCard(item, statusClass) {
    const parts = formatCreatedAt(item.createdAt);
    const card = createElement("div", "main__catalogItem");

    card.appendChild(createElement("p", "main__catalogId", ` ${item.userName}`));

    const date = createElement("p", "main__catalogDate");
    date.appendChild(createElement("span", null, `Дата: ${parts.date}`));
    date.appendChild(document.createElement("br"));
    date.appendChild(createElement("span", null, ` время: ${parts.time}`));
    card.appendChild(date);

    card.appendChild(
        createElement("p", "main__catalogItemName", item.userQuery)
    );
    card.appendChild(
        createElement("p", "main__catalogItemComment", item.userComment)
    );

    const progress = createElement("p", "main__catalogItemProgress");
    progress.appendChild(
        createElement(
            "span",
            `main__catalogItemProgressbar ${statusClass}`,
            item.Progress
        )
    );
    card.appendChild(progress);

    return card;
}

function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = String(text);
    }
    return node;
}

// Время клиники — UTC+5.
function formatCreatedAt(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { date: "", time: "" };
    }
    const local = new Date(parsed.getTime() + 5 * 60 * 60 * 1000).toISOString();
    return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function createSubmissionKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function logRejected(label, result) {
    if (result.status === "rejected") {
        console.warn(`Не удалось отправить заявку: ${label}`, result.reason);
    }
}

function checkInputs(inputs, textArea, checkedOrNot, inputsRadio) {
    let res = true;
    inputs.forEach((element) => {
        if (element.value.trim() == "") {
            console.log("error");
            element.style.cssText = `
            border:2px solid red
            `;
            res = false;
        } else {
            element.style.cssText = `none`;
        }
    });

    if (textArea.value.trim() == "") {
        console.log("error");
        textArea.style.cssText = `border:2px solid red`;
        res = false;
    } else {
        textArea.style.cssText = `none`;
    }

    let radioFalse = false;
    inputsRadio.forEach((item) => {
        if (item.checked) {
            radioFalse = true;
        }
    });
    if (radioFalse) {
        checkedOrNot.style.cssText = ``;
    } else {
        checkedOrNot.style.cssText = `border:4px solid red`;
        res = false;
    }
    return res;
}

// Фильтрация по телефону выполняется на сервере: страница больше не
// выгружает в браузер все заявки всех сотрудников.
function searchQueriesByPhone(phone) {
    const config = window.HELPDESK_CONFIG;
    const query =
        `?filters[userPhone][$startsWith]=${encodeURIComponent(phone)}` +
        `&pagination[pageSize]=${config.searchPageSize}` +
        `&sort=createdAt:desc`;

    return Promise.all(
        config.statusEndpoints.map((endpoint) =>
            axios
                .get(`${config.legacyApiUrl}${endpoint}${query}`)
                .then((res) =>
                    ((res.data && res.data.data) || []).map(
                        (row) => row.attributes
                    )
                )
                .catch((err) => {
                    console.warn(`Не удалось загрузить статусы: ${endpoint}`, err);
                    return [];
                })
        )
    ).then((groups) =>
        groups
            .reduce((all, group) => all.concat(group), [])
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    );
}
