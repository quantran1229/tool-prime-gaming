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
    const [data, , location, timeout] = await Promise.all([
      loadDoc(),
      // initalBrowser(),
    ]);
    proxyLocations = location;
    console.log("Initial DONE");
    return [data, timeout];
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
  const resultCell = defaultSheet.getCell(line.rowIndex - 1, 3);
  if (!resultCell.value) {
    for (let i = 0; i < 2; i++) {
      if (browser) await browser.close();
      await initalBrowser();
      if (resultCell.value) break;
      try {
        await page.goto(Cnf.amz_signin_link, {
          waitUntil: "networkidle2",
        });
        console.log("Sign in....");
        await page.type("#ap_email", line._rawData[0]);
        await page.$eval("input[id=continue]", (el) => el.click());
        await page.waitForSelector("input[id=ap_password]", { timeout: 5000 });
        // password
        await page.type("#ap_password", line._rawData[1]);
        await page.$eval("input[id=signInSubmit]", (el) => el.click());
        await page.waitForSelector("input[id=auth-mfa-otpcode]", {
          timeout: 5000,
        });
        let otp = await getOTP(line._rawData[2]);
        if (!otp) {
          resultCell.value = "Can't get OTP";
          break;
        }
        // OTP
        await page.type("#auth-mfa-otpcode", otp);
        await page.$eval("input[id=auth-signin-button]", (el) => el.click());
        try {
          await page.waitForSelector("a[id=ap-account-fixup-phone-skip-link]", {
            timeout: 5000,
          });
          await page.$eval("a[id=ap-account-fixup-phone-skip-link]", (el) =>
            el.click()
          );
        } catch (err) {}
        await page.waitForSelector("input[id=twotabsearchtextbox]", {
          timeout: 5000,
        });
        console.log('Sign in sucess!')
        await page.goto(Cnf.amz_riot_link, {
          waitUntil: "networkidle2",
        });

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
          await page.waitForNavigation({ waitUntil: "networkidle2" , timeout: 60000});
          console.log("Activated!");
        } catch (err) {
          console.log("Activated! Skip activating!");
        }
        // Check user link or not
        console.log("Checking riot is linked or not!")
        try {
          await page.waitForSelector(
            `p[data-a-target="Customer3PDisplayName"]`,
            {
              timeout: 5000,
            }
          );
          const linkedAccount = await page.$eval(
            'p[data-a-target="Customer3PDisplayName"]',
            (element) => element.textContent
          );
          console.log("Account is linked")
          resultCell.value = 'Account Link '+linkedAccount
          break;
        } catch (err) {
          console.log("Account is new!")
          resultCell.value = 'New'
          break;
        }
      } catch (err) {
        const [wrongPassword] = await page.$x(
          "//span[contains(text(), 'Your password is incorrect')]"
        );
        if (wrongPassword) {
          resultCell.value = "Your password is incorrect";
          break;
        }
        const [noEmailFoundErr] = await page.$x(
          "//span[contains(text(), 'We cannot find an account with that email address')]"
        );
        if (noEmailFoundErr) {
          resultCell.value =
            "We cannot find an account with that email address";
          break;
        }
        const [otpWrong] = await page.$x(
          "//span[contains(text(), 'The One Time Password (OTP) you entered is not valid. Please try again.')]"
        );
        if (otpWrong) {
          resultCell.value = "OTP is invalid";
          break;
        }
        const [suspendAccount] = await page.$x(
          "//h4[contains(text(), 'Account on hold temporarily')]"
        );
        if (suspendAccount) {
          resultCell.value = "Account on hold temporarily";
          break;
        }
        const [importantMess] = await page.$x(
          "//h4[contains(text(), 'Important Message!')]"
        );
        if (importantMess) {
          resultCell.value = "Important Message!";
          break;
        }
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
  let [data] = await initial();
  if (data) {
    for (let line of data) {
      await execLine(line);
    }
  }
  done();
};

run();
