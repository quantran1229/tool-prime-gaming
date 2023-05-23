const Cnf = require("./config.json");
const creds = require("../google_cred.json");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const execFile = require("child_process").execSync;
let count = 1;
const puppeteer = require("puppeteer-extra");
const pluginStealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(pluginStealth());

const TINSOFT_URL = "http://proxy.tinsoftsv.com/api/";
let proxyLocations = [];
let currentLocation = -1;
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

moveMouseRandomly = async () => {
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.down();
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.up();
};

updateProxy = async () => {
  if (!Cnf.use_proxy) return 0;
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
  const resultCell = defaultSheet.getCell(line.rowIndex - 1, 24);
  let hasAddAddress = defaultSheet.getCell(line.rowIndex - 1, 25).value == "ok";
  let creditCardAdded = !isNaN(
    defaultSheet.getCell(line.rowIndex - 1, 26).value
  )
    ? defaultSheet.getCell(line.rowIndex - 1, 26).value * 1
    : 0;
  console.log("Has add address?",hasAddAddress, "Number of credit cards added:",creditCardAdded);
  if (!resultCell.value && !(hasAddAddress && creditCardAdded == Cnf.no_card_changed)) {
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
        if (!hasAddAddress) {
          try {
            await page.goto(Cnf.address_link, {
              waitUntil: "networkidle2",
            });
            await page.waitForSelector('a[id="ya-myab-address-add-link"]', {
              timeout: 10000,
            });
            await page.click('a[id="ya-myab-address-add-link"]');
            await page.waitForSelector(
              'input[id="address-ui-widgets-enterAddressPhoneNumber"]',
              {
                timeout: 10000,
              }
            );
            await delay(2000);
            await Promise.all([page.evaluate(
              () =>
                (document.getElementById(
                  "address-ui-widgets-enterAddressFullName"
                ).value = "")
            ),page.evaluate(
              () =>
                (document.getElementById(
                  "address-ui-widgets-enterAddressLine1"
                ).value = "")
            ), page.evaluate(
              () =>
                (document.getElementById(
                  "address-ui-widgets-enterAddressCity"
                ).value = "")
            ), page.evaluate(
              () =>
                (document.getElementById(
                  "address-ui-widgets-enterAddressPostalCode"
                ).value = "")
            ), page.evaluate(
              () =>
                (document.getElementById(
                  "address-ui-widgets-enterAddressPhoneNumber"
                ).value = "")
            ) ]);
            await page.type(
              'input[id="address-ui-widgets-enterAddressFullName"]',
              line._rawData[8]
            );
            await page.type(
              'input[id="address-ui-widgets-enterAddressLine1"]',
              line._rawData[4]
            );
            await page.type(
              'input[id="address-ui-widgets-enterAddressCity"]',
              line._rawData[5]
            );
            await page.type(
              'input[id="address-ui-widgets-enterAddressPostalCode"]',
              line._rawData[7]
            );
            await page.type(
              'input[id="address-ui-widgets-enterAddressPhoneNumber"]',
              line._rawData[3]
            );
            const optionsArray = await page.evaluate(() =>
              Array.from(
                document.querySelectorAll(
                  "#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId option"
                )
              ).map((element) => {
                return {
                  value: element.value,
                  text: element.innerText,
                };
              })
            );
            let state =
              optionsArray.find((e) => e.text == line._rawData[6])?.value ||
              optionsArray[2].value;
            await page.select(
              "select#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId",
              state
            );
            const checkbox = await page.$(
              "#address-ui-widgets-use-as-my-default"
            );
            if (!(await (await checkbox.getProperty("checked")).jsonValue())) {
              await checkbox.click();
            }
            await page.click(
              'span[id="address-ui-widgets-form-submit-button-announce"]'
            );
            try {
              await page.waitForSelector('span[id="address-ui-widgets-form-submit-button-announce"]',{
                timeout:3000
              })
              await page.click(
                'span[id="address-ui-widgets-form-submit-button-announce"]'
              );
            } catch (err) {}
            try {
              await page.waitForSelector('input[name="address-ui-widgets-saveOriginalOrSuggestedAddress"]',{
                timeout:3000
              })
              await page.click(
                'input[name="address-ui-widgets-saveOriginalOrSuggestedAddress"]'
              );
            } catch (err) {}
            for (let x = 0; x < 3; x++) {
              try {
                await delay(3000);
                const [doneChangeAddress,submittedChangeAddress] = await Promise.all([page.$x(
                  "//h4[contains(text(), 'Address saved')]"
                ),page.$x(
                  "//h4[contains(text(), 'submitted an address that is already in your address book')]"
                )])
                
                if (doneChangeAddress || submittedChangeAddress) {
                  const resultChangeAddress = defaultSheet.getCell(
                    line.rowIndex - 1,
                    25
                  );
                  console.log("Success change address!")
                  resultChangeAddress.value = "ok";
                  hasAddAddress = true;
                  await defaultSheet.saveUpdatedCells();
                  break;
                }
              } catch (err) {
                console.log(err)
              }
            }
          } catch (err) {
            console.log(err);
            console.log("Error while change address");
          }
        } else {
          console.log("Skip adding address");
        }

        if (creditCardAdded < Cnf.no_card_changed && hasAddAddress) {
          console.log("Adding cards....");
          let cardsList = [
            {
              id: line._rawData[9],
              month: line._rawData[10],
              year: line._rawData[11],
            },
            {
              id: line._rawData[12],
              month: line._rawData[13],
              year: line._rawData[14],
            },
            {
              id: line._rawData[15],
              month: line._rawData[16],
              year: line._rawData[17],
            },
            {
              id: line._rawData[18],
              month: line._rawData[19],
              year: line._rawData[20],
            },
            {
              id: line._rawData[21],
              month: line._rawData[22],
              year: line._rawData[23],
            },
          ];
          for (let cardId = creditCardAdded; cardId < Cnf.no_card_changed; cardId++) {
            console.log("Adding card", cardId, cardsList[cardId].id);
            try {
              await page.goto(Cnf.card_link, {
                waitUntil: "networkidle2",
              });
              await delay(2000);
              await page.waitForSelector('input[value="Change"]', {
                timeout: 10000,
              });
              await page.$eval('input[value="Change"]', (el) => el.remove());
              await page.click('input[value="Change"]');
              await page.waitForSelector(
                "#apx-add-credit-card-action-test-id",
                {
                  timeout: 10000,
                }
              );
              const linkHandlers = await page.$x(
                "//a[contains(text(), 'Add a credit or debit card')]"
              );
              if (linkHandlers.length > 0) {
                await moveMouseRandomly();
                await page.click(
                  'a[class="a-link-normal apx-secure-registration-content-trigger-js"]'
                );
              } else {
                throw new Error("Link not found");
              }
              let idName = (
                await page.$$eval(
                  `a[class="a-link-normal apx-secure-registration-content-trigger-js"]`,
                  (el) => el.map((x) => x.getAttribute("id"))
                )
              )[0].split("-")[1];
              await delay(3000);
              let numIFrame = 40
              for (numIFrame; numIFrame < 50; numIFrame ++) {
                try {
                  console.log("Looking for iFrame ...",numIFrame)
                  await page.waitForSelector(`iframe[name="ApxSecureIframe-pp-${idName}-${numIFrame}"]`, {
                    timeout: 2000
                  });
                  break;
                } catch (err) {
                  clearLastLine()
                }
              }
              const elementHandle = await page.$(
                `iframe[name="ApxSecureIframe-pp-${idName}-${numIFrame}"]`
              );
              const frame = await elementHandle.contentFrame();
              await frame.waitForSelector(
                'input[name="ppw-accountHolderName"]',
              );
              await frame.type(
                'input[name="ppw-accountHolderName"]',
                line._rawData[8].toUpperCase()
              );
              await frame.type(
                'input[name="addCreditCardNumber"]',
                cardsList[cardId].id
              );
              await delay(2000)
              await frame.select(
                'select[name="ppw-expirationDate_month"]',
                cardsList[cardId].month * 1 + ""
              );
              await frame.select(
                'select[name="ppw-expirationDate_year"]',
                "20" + cardsList[cardId].year
              );
              await frame.click(
                'input[name="ppw-widgetEvent:AddCreditCardEvent"]'
              );
              await frame.waitForSelector('input[name="ppw-widgetEvent:SelectAddressEvent"]',{
                timeout: 5000
              })
              try {
                await frame.click('input[name="ppw-widgetEvent:SelectAddressEvent"]')
              } catch (err) {}
              await page.waitForSelector(
                "#apx-add-credit-card-action-test-id",
                {
                  timeout: 10000,
                }
              );
              console.log("Adding card", cardId, "success")
              creditCardAdded++
            } catch (err) {
              console.log("Error when add card id = ", cardId, err);
              break;
            }
            if (cardId < creditCardAdded) continue;
          }
          if (creditCardAdded) {
            const resultChangeCard = defaultSheet.getCell(
              line.rowIndex - 1,
              26
            );
            resultChangeCard.value = creditCardAdded;
            await defaultSheet.saveUpdatedCells();
          }
        } else {
          console.log("Skip adding card");
        }
        if (hasAddAddress && creditCardAdded == Cnf.no_card_changed) {
          console.log("Done change info!")
          resultCell.value = "Done";
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

const clearLastLine = () => {
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};

run = async () => {
  let [data, timeout] = await initial();
  if (data) {
    for (let line of data) {
      await execLine(line);
      console.log("Checking to change proxy")
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
  done();
};

run();
