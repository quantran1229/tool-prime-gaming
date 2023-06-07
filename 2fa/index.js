const Cnf = require("./config.json");
const creds = require("../google_cred.json");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const puppeteer = require("puppeteer-extra");
const pluginStealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(pluginStealth());
const fs = require("fs");
const execFile = require("child_process").execSync;

const TINSOFT_URL = "http://proxy.tinsoftsv.com/api/";
let proxyLocations = [];
let currentLocation = -1;
let count = 1;
let browser;
let page;
let defaultSheet;

checkKey = async () => {
  if (!Cnf.use_proxy) {
    return;
  }
  console.log("Checking tinsoft key: START");
  const result = await axios.get(
    TINSOFT_URL + "getKeyInfo.php?key=" + Cnf.tinsoft_key
  );
  if (result.data.success != true) {
    throw new Error("Tinsoft key not found or expired. Please check again!");
  }
  console.log("Checking tinsoft key: DONE");
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
  if (!Cnf.use_proxy) {
    return 0;
  }
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

updateProxy = async () => {
  for (let i = 0; i < 3; i++) {
    if (!Cnf.use_proxy) return 0;
    console.log("Updating Proxy START");
    const randomLocation = 0;
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
      console.log("Error when update Proxy: " + result.data.description);
    }
    await delay(60 * 1000);
  }
  throw new Error("Error when update Proxy after 3 times. Exist script!");
};

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
const clearLastLine = () => {
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};

initial = async () => {
  console.log("Initial START");
  console.log("Config:");
  console.log(Cnf);
  try {
    const [data, , location, timeout] = await Promise.all([
      loadDoc(),
      checkKey(),
      getLocationProxy(),
      updateProxy(),
    ]);
    proxyLocations = location;
    console.log("Initial DONE");
    return [data,timeout];
  } catch (err) {
    console.log(err)
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
        console.log("Sign in sucess!");
        await page.goto(Cnf["2fa_link"], {
          waitUntil: "networkidle2",
        });

        console.log("Disabling 2fa...");
        await page.waitForSelector(
          'input[id="confirm-disable-dialog-modal-submit"]',
          {
            timeout: 10000,
          }
        );
        await delay(1000);
        await page.click("#disable-button");
        await page.waitForSelector(
          'input[id="confirm-disable-dialog-modal-submit"]',
          {
            timeout: 10000,
          }
        );
        await page.$eval(
          'input[id="remove-devices-checkbox-input"]',
          (check) => (check.checked = true)
        );
        await delay(1000);
        await page.click("#confirm-disable-dialog-modal-submit");
        await page.waitForSelector("#skip-feedback", {
          timeout: 5000,
        });
        await page.click("#skip-feedback");
        await delay(1000);
        await page.waitForSelector("a[id=sia-settings-enable-mfa]", {
          timeout: 10000,
        });
        console.log("Disabled 2fa success");
        await page.click("a[id=sia-settings-enable-mfa]");
        const clickApp = await page.waitForSelector(
          "a[id=sia-otp-accordion-totp-header]",
          {
            timeout: 5000,
          }
        );
        await clickApp.click();
        await delay(500);
        await page.click("#sia-auth-app-cant-scan-link");
        let code = await page.$eval(
          "#sia-auth-app-formatted-secret",
          (element) => element.textContent
        );
        code = code.replace(/ /g, "");
        const newOTP = await getOTP(code);
        await page.type("#ch-auth-app-code-input", newOTP);
        await page.click("#ch-auth-app-submit");
        try {
          await page.waitForSelector("#enable-mfa-form-submit", {
            timeout: 10000,
          });
          await page.click("#enable-mfa-form-submit");
          resultCell.value = code.replace(/ /g, "");
          console.log("Done");
          break;
        } catch (err) {
          console.log("Got error when setup 2fa");
          resultCell.value = "ERROR WHEN SETUP 2fa";
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
    count = count >= Cnf.no_account_per_proxy ? -1 : count + 1;
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

updateProxier = async (str) => {
  if (!Cnf.use_proxy) {
    return 0;
  }
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

run = async () => {
  let [data, timeout] = await initial();
  if (data) {
    for (let line of data) {
      await execLine(line);
      if (Cnf.use_proxy) {
        console.log("Checking to change proxy");
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
          count = 0;
        }
      }
    }
  }
  done();
};

run();
