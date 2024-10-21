document.addEventListener("DOMContentLoaded", function () {
    const tokenEl = "7539134948:AAGSRsFjbn_McxN_jkz3QpyM2EUcua-vK8s";
    const tokenSan = "7539134948:AAGSRsFjbn_McxN_jkz3QpyM2EUcua-vK8s";
    let token = "";
    let CHAT_ID;

    let success = document.querySelector(".success");
    let successImg = document.querySelector(".success__img");
    let checkedOrNot = document.querySelector(".checkedOrNot");
    let inputsRadio = document.querySelectorAll(".inputMar");
    let imageContainer = document.getElementsByTagName("body");
    let userDataQuery = getUsersQuery();
    let radioInput = document.querySelectorAll(".radioInput");
    let inputs = document.querySelectorAll(".main__inputs");
    let textArea = document.querySelector("textarea");
    let btn = document.querySelector(".btn__submit");
    let admin = null;

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        let res = checkInputs(inputs, textArea, checkedOrNot, radioInput);
        console.log(res);
        if (res) {
            let query;
            radioInput.forEach((item) => {
                if (item.checked) {
                    query = item.value;
                    console.log(item);
                    if (item.id.includes("elektriks")) {
                        CHAT_ID = -4570318896;
                        console.log(item.value + " SAID");
                        admin = "/api/elektriks";
                        token =
                            "7539134948:AAGSRsFjbn_McxN_jkz3QpyM2EUcua-vK8s";
                    } else if (item.id.includes("santehniks")) {
                        CHAT_ID = -4548047122;
                        console.log(item.value + " Ernar and TIMUR");
                        admin = "/api/santehniks";
                        token =
                            "7525962971:AAEoBGefK4e-PjIeNC24X_KY2u7eQU_rI0s";
                    } else if (item.id.includes("ventel")) {
                        CHAT_ID = -4587546685;
                        console.log(item.value + " Ernar and TIMUR");
                        admin = "/api/ventilyaczionshhiks";
                        token =
                            "7525962971:AAEoBGefK4e-PjIeNC24X_KY2u7eQU_rI0s";
                    }
                }
            });
            const URI_API = `https://api.telegram.org/bot${token}/sendMessage`;
            let massage = `<b>Заявка  ${query}</b>\n`;
            massage += `<b>ФИО : ${inputs[1].value}</b>\n`;
            massage += `<b>Отделение : ${inputs[2].value}</b>\n`;
            massage += `<b>Телеофн : ${inputs[0].value}</b>\n`;
            massage += `<b>Комментарий : ${textArea.value}</b>\n`;
            massage += `<b>Запрос : ${query}</b>\n`;
            axios
                .post(`http://192.168.101.25:1337${admin}`, {
                    data: {
                        userName: inputs[1].value,
                        userPhone: inputs[0].value,
                        userSide: inputs[2].value,
                        userComment: textArea.value,
                        userQuery: query,
                    },
                })
                .then((res) => {
                    inputs.forEach((item) => (item.value = ""));
                    textArea.value = "";
                    success.style.display = "block";
                    successImg.classList.add("successLoadingActive");

                    axios
                        .post(URI_API, {
                            chat_id: CHAT_ID,
                            parse_mode: "html",
                            text: massage,
                        })
                        .then((res) => {})
                        .catch((err) => {
                            console.log(err);
                        });

                    setTimeout(() => {
                        success.style.display = "none";
                        successImg.classList.remove("successLoadingActive");
                    }, 3400);
                })
                .then(() => {
                    userDataQuery = "";
                    userDataQuery = getUsersQuery();
                })
                .then(() => {
                    queryListAdd();
                })
                .catch((err) => {
                    console.log(err);
                });
        }
    });
    let searchInput = document.querySelector(".main__searchInput");
    let userPhones = [];
    let catalog = document.querySelector(".main__catalog");
    function queryListAdd() {
        userDataQuery.then(function (res) {
            searchInput.addEventListener("input", (e) => {
                catalog.innerHTML = ``;
                userPhones = [];
                res.forEach((item) => {
                    if (item.userPhone.indexOf(e.target.value) === 0) {
                        userPhones.push(item);
                    }
                });
                if (e.target.value.length >= 5) {
                    userPhones.forEach((item) => {
                        let hours =
                            " время: " +
                            (+item.createdAt.slice(11, -11) + 5) +
                            ":" +
                            item.createdAt.slice(14, -8);
                        if (item.Progress == "Сделано") {
                            catalog.innerHTML += `
                    <div class="main__catalogItem ">
                        <p class="main__catalogId"> ${item.userName}</p>
                        <p class="main__catalogDate"><span>Дата: ${item.createdAt.slice(
                            0,
                            -14
                        )}</span> <br /> <span>${hours}</span></p>
                        <p class="main__catalogItemName">${item.userQuery}</p>
                        <p class="main__catalogItemComment">${
                            item.userComment
                        }</p>
                        <p class="main__catalogItemProgress"><span class="main__catalogItemProgressbar greenDone">${
                            item.Progress
                        }</span></p>
                    </div>
                    `;
                        } else if (item.Progress == "в работе") {
                            catalog.innerHTML += `
                    <div class="main__catalogItem ">
                        <p class="main__catalogId"> ${item.userName}</p>
                        <p class="main__catalogDate"><span>Дата: ${item.createdAt.slice(
                            0,
                            -14
                        )}</span> <br /> <span>${hours}</span></p>
                        <p class="main__catalogItemName">${item.userQuery}</p>
                        <p class="main__catalogItemComment">${
                            item.userComment
                        }</p>
                        <p class="main__catalogItemProgress"><span class="main__catalogItemProgressbar yellowInWork">${
                            item.Progress
                        }</span></p>
                    </div>
                    `;
                        } else if (item.Progress == "Новая заявка") {
                            catalog.innerHTML += `
                    <div class="main__catalogItem ">
                        <p class="main__catalogId"> ${item.userName}</p>
                        <p class="main__catalogDate"><span>Дата: ${item.createdAt.slice(
                            0,
                            -14
                        )}</span> <br /> <span>${hours}</span></p>
                        <p class="main__catalogItemName">${item.userQuery}</p>
                        <p class="main__catalogItemComment">${
                            item.userComment
                        }</p>
                        <p class="main__catalogItemProgress"><span class="main__catalogItemProgressbar blueNewQuery">${
                            item.Progress
                        }</span></p>
                    </div>
                    `;
                        }
                    });
                }
            });
        });
    }

    queryListAdd();
});

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

    console.log(inputsRadio);
    let radioFalse = false;
    inputsRadio.forEach((item) => {
        if (item.checked == false) {
            console.log(item.checked);
        } else if (item.checked) {
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

async function getUsersQuery() {
    let userObj = [];

    axios
        .get(
            "http://192.168.101.25:1337/api/santehniks?pagination[pageSize]=1000&sort=createdAt:desc"
        )
        .then(function (res) {
            res.data["data"].map((item) => {
                userObj.push(item.attributes);
            });
        });
    axios
        .get(
            "http://192.168.101.25:1337/api/plotniks?pagination[pageSize]=1000&sort=createdAt:desc"
        )
        .then(function (res) {
            res.data["data"].map((item) => {
                userObj.push(item.attributes);
            });
        });
    await axios
        .get(
            "http://192.168.101.25:1337/api/elektriks?pagination[pageSize]=1000&sort=createdAt:desc"
        )
        .then(function (res) {
            res.data["data"].map((item) => {
                userObj.push(item.attributes);
            });
        });

    return userObj;
}
