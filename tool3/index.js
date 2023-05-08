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
puppeteer.use(pluginStealth());

let browser;
let page;
let defaultSheet;
let defaultSheetAmz;

loadRIOTDoc = async () => {
  console.log("Loading data from riot google sheet: START");
  const doc = new GoogleSpreadsheet(Cnf.google_sheet_riot_id);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  defaultSheet = doc.sheetsByIndex[parseInt(Cnf.google_sheet_riot_index, 10)];
  await defaultSheet.loadCells();
  const lines = await defaultSheet.getRows();
  console.log("Loading data from riot google sheet: DONE");
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
    const [riotData] = await Promise.all([
      loadRIOTDoc(),
    ]);
    console.log("Initial DONE");
    return [riotData];
  } catch (err) {
    console.log("Initial fail due to :" + err.toString());
  }
};

moveMouseRandomly = async () => {
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.down();
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.up();
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

getOTP = async (code2F) => {
  const value = await axios.get(`https://2fa.live/tok/${code2F}`);
  if (value.data) {
    return value.data.token;
  }
  return null;
};

execLine = async (line) => {
  console.log(
    "START CHECKING ACCOUNT",
    line._rawData[0],
    "Line",
    line.rowIndex
  );
  const resultCell = defaultSheet.getCell(line.rowIndex - 1, 5);
  if (!resultCell.value) {
    for (let i = 0; i < 2; i++) {
      if (browser) await browser.close();
      await initalBrowser();
      if (resultCell.value) break;
      try {
        await page.goto(Cnf.amz_riot_link, {
          waitUntil: "networkidle2",
        });
        console.log("Sign in....");
        await delay(3000);
        await page.$eval(`button[data-a-target="sign-in-button"]`, (el) =>
          el.click()
        );
        await page.waitForSelector("#ap_email");
        await page.type("#ap_email", line._rawData[0]);
        await page.type("#ap_password", line._rawData[1]);
        await page.$eval("input[id=signInSubmit]", (el) => el.click());
        let [, otp] = await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2" }),
          getOTP(line._rawData[2]),
        ]);
        if (!otp) {
          resultCell.value = "Can't get OTP";
          break;
        }
        // OTP
        await page.type("#auth-mfa-otpcode", otp);
        await page.$eval("input[id=auth-signin-button]", (el) => el.click());
        await delay(5000);
        try {
          await page.waitForSelector("a[id=ap-account-fixup-phone-skip-link]", {
            timeout: 5000,
          });
          await page.$eval("a[id=ap-account-fixup-phone-skip-link]", (el) =>
            el.click()
          );
        } catch (err) {}

        try {
          console.log("Try to activate");
          await page.waitForSelector(
            'button[data-a-target="activate-prime-button"]',
            {
              timeout: 5000,
            }
          );
          await page.click('button[data-a-target="activate-prime-button"]');
          console.log("Not activate prime! Activating!");
          await page.waitForNavigation({
            waitUntil: "networkidle2",
            timeout: 60000,
          });
          console.log("Activated!");
        } catch (err) {
          console.log("Activated! Skip activating!");
        }

        try {
          console.log("Try to link account");
          await page.waitForSelector(
            'button[data-a-target="LinkAccountButton"]',
            {
              timeout: 10000,
            }
          );
          await page.$eval('button[data-a-target="LinkAccountButton"]', (el) =>
            el.click()
          );
          await page.$eval('button[data-a-target="LinkAccountButton"]', (el) =>
            el.remove()
          );
          await page.$eval('button[data-a-target="LinkAccountButton"]', (el) =>
            el.click()
          );
          await page.waitForSelector('input[data-testid="input-username"]', {
            timeout: 10000,
          });
          console.log("Sign in Riot...");
          try {
            await page.type(
              'input[data-testid="input-username"]',
              line._rawData[3]
            );
            await page.type(
              'input[data-testid="input-password"]',
              line._rawData[4]
            );
            await page.click(`button[title="Sign In"]`);
            await page.waitForSelector('button[data-testid="consent-button"]', {
              timeout: 10000,
            });
            console.log("Consenting...");
            await page.click(`button[data-testid="consent-button"]`);
            await page.waitForSelector(
              'p[data-a-target="Customer3PDisplayName"]',
              {
                timeout: 20000,
              }
            );
            const linkedAccount = await page.$eval(
              'p[data-a-target="Customer3PDisplayName"]',
              (element) => element.textContent
            );
            resultCell.value = linkedAccount;
            console.log("Linked: ", linkedAccount);
          } catch (err) {
            const [wrongRiotAccount] = await page.$x(
              "//span[contains(text(), 'Your username or password may be incorrect')]"
            );
            if (wrongRiotAccount) {
              resultCell.value = "Wrong riot account user/pass";
              break;
            }
          }
        } catch (err) {
          console.log(err);
        }
        // Get in game-content
        try {
          await page.click(`button[data-a-target="buy-box_call-to-action"]`);
          await page.waitForSelector('h1[data-a-target="header-state_JustClaimed"]', {
            timeout: 10000
          })
          defaultSheet.getCell(line.rowIndex - 1, 6).value = 'COLLECTED'
          console.log("DONE!")
        } catch(err) {
          console.log('Gift not found')
        }
        break;
      } catch (err) {
        console.log(err);
      }
    }
  }
  await defaultSheet.saveUpdatedCells();
  if (browser) await browser.close();
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
