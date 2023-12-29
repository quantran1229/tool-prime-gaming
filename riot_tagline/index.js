const Cnf = require("./config.json");
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
const { channel } = require("diagnostics_channel");
puppeteer.use(pluginStealth());

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

initalBrowser = async () => {
  browser = await puppeteer.launch({
    headless: Cnf.is_headless,
    executablePath: Cnf.chrome_path,
  });
  const context = await browser.createIncognitoBrowserContext();
  //   await context.overridePermissions(process.env.GAME_LINK, ["clipboard-read"]);
  page = await context.newPage();
  const client = await page.target().createCDPSession();
  await client.send("Network.clearBrowserCookies");
  await client.send("Network.clearBrowserCache");
};

initial = async () => {
  console.log("Initial START");
  console.log("Config:");
  console.log(Cnf);
  try {
    const [data, , location, timeout] = await Promise.all([loadDoc()]);
    proxyLocations = location;
    console.log("Initial DONE");
    return [data, timeout];
  } catch (err) {
    console.log("Initial fail due to :" + err.toString());
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
  console.log("START CHECKING ACCOUNT", line._rawData[0], "Line", line.rowInd);
  let statusLogin = defaultSheet.getCell(line.rowIndex - 1, 5);
  let statusEditTags = defaultSheet.getCell(line.rowIndex - 1, 6);
  if (!line._rawData[1] || !line._rawData[2]) {
    statusLogin.value = "Account information or password is missing";
    await defaultSheet.saveUpdatedCells();
    return;
  }

  if (!statusEditTags.value) {
    for (let i = 0; i < 2; i++) {
      if (browser) await browser.close();
      await initalBrowser();
      if (statusEditTags.value) break;

      try {
        await page.goto(Cnf.riot_login_link, {
          waitUntil: "networkidle2",
        });
        console.log("Sign in....");
        await page.waitForSelector('input[name="username"]', { timeout: 5000 });

        // Login riot game
        await page.type('input[name="username"]', line._rawData[1]);
        await page.type('input[name="password"]', line._rawData[2]);
        await delay(1000);
        const button = await page.$('button[data-testid="btn-signin-submit"]');
        await button.click();
        await delay(3000);
        // check username or password is incorrect
        try {
          const errorSpan = await page.$('span.status-message.text__web-error');
          if (errorSpan) {
            console.log("Cannot log in ...");
            statusLogin.value = "Cannot log in ";
            await defaultSheet.saveUpdatedCells();
            await browser.close();
            return;
          }
        } catch (e) {
        }
        
        await page.waitForNavigation({ waitUntil: "networkidle2" });
        statusLogin.value = "Login successfully";
        await defaultSheet.saveUpdatedCells();

        // edit riot_id
        const inputRiotId = await page.$(
          'input[data-testid="riot-id__riotId"]'
        );
        await inputRiotId.click({ clickCount: 3 });
        await inputRiotId.press("Backspace");
        await inputRiotId.type(line._rawData[3]);

        // edit tagline
        const inputTagline = await page.$(
          'input[data-testid="riot-id__tagline"]'
        );
        await inputTagline.click({ clickCount: 3 });
        await inputTagline.press("Backspace");
        await inputTagline.type(line._rawData[4]);

        try {
          console.log("Start editing tagline...");
          const saveChangesButton = await page.$(
            '[data-testid="riot-id__save-btn"]'
          );
          const isDisabled = await saveChangesButton.evaluate(
            (button) => button.disabled
          );
          if (isDisabled) {
            console.log("Can't edit tagline");
            statusEditTags.value = "Can't edit tagline";
          } else {
            await saveChangesButton.click();
            console.log("Register Tag DONE");
            statusEditTags.value = "Register DONE";
          }
          console.log("End editing tagline...");

        } catch (e) {
          statusEditTags.value = "Can't edit tagline";
        }

        await defaultSheet.saveUpdatedCells();
        await browser.close();
      } catch (e) {
        console.log(e);
      }
    }
  }
};
done = async () => {
  if (browser) {
    await browser.close();
  }
  console.log("SCRIPT EXIT!");
  process.exit();
};
const clearLastLine = () => {
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};
run = async () => {
  let [riotData] = await initial();
  if (riotData) {
    for (let line of riotData) {
      await execLine(line);
    }
  }
  done();
};

run();
