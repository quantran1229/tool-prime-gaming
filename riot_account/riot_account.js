const Cnf = require("./riot_config.json");
const creds = require("../google_cred.json");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const execFile = require("child_process").execSync;
require("dotenv").config();
let count = 1;
const { faker } = require("@faker-js/faker");
const puppeteer = require("puppeteer-extra");
const pluginStealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(pluginStealth());

const TINSOFT_URL = "http://proxy.tinsoftsv.com/api/";
let proxyLocations = [];
let currentLocation = -1;
let browser;
let page;
let defaultSheet;

loadDoc = async () => {
  console.log("Loading data from google sheet: START");
  const doc = new GoogleSpreadsheet(Cnf.google_sheet_id);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  defaultSheet = doc.sheetsByIndex[parseInt(Cnf.google_sheet_index, 10)];
  await defaultSheet.loadCells();
  const lines = await defaultSheet.getRows();
  console.log("Loading data from google sheet: DONE");
  return lines;
};

checkKey = async () => {
  console.log("Checking tinsoft key: START");
  const result = await axios.get(
    TINSOFT_URL + "getKeyInfo.php?key=" + Cnf.tinsoft_key
  );
  if (result.data.success != true) {
    throw new Error("Tinsoft key not found or expired. Please check again!");
  }
  console.log("Checking tinsoft key: DONE");
};

initalBrowser = async () => {
  browser = await puppeteer.launch({
    headless: process.env.IS_HEADLESS === "true",
    executablePath: process.env.CHROME_PATH,
  });
  const context = await browser.createIncognitoBrowserContext();
  //   await context.overridePermissions(process.env.GAME_LINK, ["clipboard-read"]);
  page = await context.newPage();
};

initial = async () => {
  console.log("Initial START");
  console.log("Config:");
  console.log({
    key: Cnf.tinsoft_key,
    sheetId: Cnf.google_sheet_id,
  });
  try {
    const [data, , location, timeout] = await Promise.all([
      loadDoc(),
      checkKey(),
      getLocationProxy(),
      updateProxy(),
      //   initalBrowser(),
    ]);
    proxyLocations = location;
    console.log("Initial DONE");
    return [data, timeout];
  } catch (err) {
    console.log("Initial fail due to :" + err.toString());
  }
};

getLocationProxy = async () => {
  result = await axios.get(TINSOFT_URL + "getLocations.php");
  return result.data.data;
};

getCurrentIp = async () => {
  const result = await axios.get(
    TINSOFT_URL + "getProxy.php?key=" + Cnf.tinsoft_key
  );
  if (result.data.success != true) {
    throw new Error("Proxy not found. Please check again!");
  } else {
  }
  return result.data.proxy;
};

getRandomLocation = () => {
  let x = proxyLocations.filter((e) => parseInt(e.location) != currentLocation);
  return x.length > 0 ? x[Math.floor(Math.random() * x.length)].location : 0;
};

updateProxier = async (str) => {
  let txtList = str.split(":");
  const host = txtList[0];
  const port = txtList[1];
  let data = fs.readFileSync("riot_account/riot_proxy.xml", {
    encoding: "utf8",
  });
  data = data.replace("${{PROXY_HOST}}", host).replace("${{PROXY_PORT}}", port);
  fs.writeFileSync("riot_account/riot_proxy.ppx", data);
  console.log("Update Proxier START");
  try {
    try {
      fs.unlinkSync(Cnf.proxier_path + "\\riot_proxy.ppx");
    } catch (err) {
      console.log(err);
    }
    try {
      execFile(".\\riot_account\\riot_proxy.ppx", {
        timeout: 8000,
      });
    } catch (err) {
      console.log("Reach timeout");
    }
    console.log("Update Proxier DONE");
  } catch (err) {
    console.log(err);
  }
};

moveMouseRandomly = async () => {
  await page.mouse.move(Math.random()*100, Math.random()*100);
  await delay(500)
  await page.mouse.down();
  await page.mouse.move(Math.random()*100, Math.random()*100);
  await delay(500)
  await page.mouse.up();
};

updateProxy = async () => {
  console.log("Updating Proxy START");
  const randomLocation = getRandomLocation() || 0;
  const result = await axios.get(
    TINSOFT_URL +
      "changeProxy.php?key=" +
      Cnf.tinsoft_key +
      "&location=" +
      randomLocation
  );

  if (result.data.success) {
    console.log(
      "NEW proxy :",
      result.data.proxy,
      " in ",
      proxyLocations[randomLocation]?.name
    );
    const timeout = Date.now() + result.data.next_change * 1000;
    currentLocation = randomLocation;
    await updateProxier(result.data.proxy);
    await delay(5000);
    return timeout;
  } else {
    throw new Error("Error when update Proxy: " + result.data.description);
  }
};

function delay(time) {
  let x;
  if (time > 30 * 1000) {
    x = setInterval(() => {});
  }
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

execLine = async (line) => {
  console.log(
    "START REGISTER FOR ACCOUNT:",
    line._rawData[0],
    "Line",
    line.rowIndex
  );
  const resultCell = defaultSheet.getCell(line.rowIndex - 1, 5);
  let isSuccess = false;
  if (!resultCell.value) {
    await initalBrowser();
    for (let i = 0; i < 2; i++) {
      try {
        await moveMouseRandomly()
        const client = await page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");
        await client.send("Network.clearBrowserCache");
        await page.goto(Cnf.riot_login_link, {
          waitUntil: "networkidle2",
        });
        try {
          await page.waitForSelector(
            "button.osano-cm-dialog__close.osano-cm-close",
            { timeout: 5000 }
          );
          const closeButton = await page.$(
            "button.osano-cm-dialog__close.osano-cm-close"
          );
          await closeButton.click();
          await delay(1000);
        } catch (err) {}
        let [signInbutton] = await page.$x(
          "//button[contains(., 'Create a Riot Account')]"
        );
        if (!signInbutton) {
          signInbutton = await page.$(".signup-link");
        }
        await signInbutton.click();

        // Email
        await moveMouseRandomly()
        await page.waitForSelector("input[name=email]");
        await page.$eval("input[name=newsletter]", (el) => el.click());
        await page.type("input[name=email]", line._rawData[0]);
        let nextButton = await page.$('button[title="Next"]');
        await nextButton.click();
        const bdate = new Date(faker.date.birthdate());
        const text =
          (bdate.getDate() < 9 ? "0" + bdate.getDate() : bdate.getDate()) +
          "" +
          (bdate.getMonth() < 9
            ? "0" + (bdate.getMonth() + 1)
            : bdate.getMonth() + 1) +
          bdate.getFullYear();

        // Birtday
        await moveMouseRandomly()
        await page.type("input[name=date_of_birth_day]", text);
        nextButton = await page.$('button[title="Next"]');
        await nextButton.click();

        // User name
        await page.type("input[name=username]", line._rawData[1]);
        nextButton = await page.$('button[title="Next"]');
        await nextButton.click();

        // Password
        await page.type("input[name=password]", line._rawData[2]);
        await page.type("input[name=confirm_password]", line._rawData[2]);
        await Promise.all([delay(1500),moveMouseRandomly()]);
        nextButton = await page.$('button[title="Next"]');
        await nextButton.click();
        try {
          await page.waitForNetworkIdle();
          await Promise.all([delay(3000), moveMouseRandomly()]);
          await page.waitForSelector(`p[data-testid="message-error"]`, {
            timeout: 15000,
          });
          const messageError = await page.$eval(
            'p[data-testid="message-error"]',
            (element) => element.textContent
          );
          resultCell.value = `FAIL DUE TO ${messageError}`;
          console.log(`FAIL DUE TO ${messageError}`);
          break;
        } catch (err) {
          //https://account.riotgames.com/
          try {
            await page.waitForNavigation("https://account.riotgames.com", {
              timeout: 10000,
            });
          } catch (err) {
            console.log(`FAIL DUE TO REGISTER ERROR OR CAPCHA`);
            await browser.close();
            await initalBrowser();
            continue;
          }
          console.log("Register DONE");
          await delay(8000);
          // insert RiotID + Tagline
          await page.type(
            'input[data-testid="riot-id__riotId"]',
            line._rawData[3]
          );
          await page.type(
            'input[data-testid="riot-id__tagline"]',
            line._rawData[4]
          );
          const saveButton = await page.$('button[title="SAVE CHANGES"]');
          await saveButton.click();
          try {
            await page.waitForSelector('div[data-testid="toast"]', {
              timeout: 5000,
            });
            const toastValue = await page.$eval(
              'div[data-testid="toast"] > p',
              (element) => element.textContent
            );
            resultCell.value = `FAIL DUE TO ${toastValue}`;
            console.log(`FAIL DUE TO ${toastValue}`);
            break;
          } catch (err) {
            resultCell.value = `${line._rawData[0]} | ${line._rawData[1]} | ${
              line._rawData[2]
            } | ${line._rawData[3]} | ${new Date().toString()}`;
            isSuccess = true;
            break;
          }
        }
      } catch (err) {
        console.log(err);
        break;
      }
    }
    count = count >= Cnf.no_account_per_proxy ? -1 : count + 1;
  }
  try {
    if (!isSuccess && !resultCell.value) resultCell.value = `FAIL UNKNOW!`;
  } catch (err) {}
  // Save to sheet
  await defaultSheet.saveUpdatedCells();
  await browser.close();
};

done = async () => {
  if (browser) {
    // await browser.close();
  }
  console.log("SCRIPT EXIT!");
  process.exit();
};
const clearLastLine = () => {
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};

run = async () => {
  let [data, timeout] = await initial();
  if (data) {
    for (let line of data) {
      await execLine(line);
      if (count == -1) {
        if (Date.now() < timeout) {
          console.log(
            "WAITING FOR UPDATE PROXY IN:",
            (timeout - Date.now()) / 1000,
            "s"
          );
          const x = setInterval(() => {
            clearLastLine();
            console.log(
              "WAITING FOR UPDATE PROXY IN:",
              (timeout - Date.now()) / 1000,
              "s"
            );
          }, 1000);
          await delay(timeout - Date.now());
          clearInterval(x);
        }
        timeout = await updateProxy();
        count = 0
      }
    }
  }
  done();
};

run();
