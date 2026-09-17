import http from "http";
import puppeteer from "puppeteer";

const PORT = process.env.PORT || 10000;
const THREE_HOURS_TWO_MINS_MS = (3 * 60 + 2) * 60 * 1000;

let isQuantRunning = false;
let lastQuantRunTime = Date.now();

// Telegram Bot Notification Dispatcher
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || token.includes("YOUR_")) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
    });
  } catch (err) {
    console.error("❌ [TELEGRAM ERROR]:", err.message);
  }
}

// Low-Level Touch/Pointer Event Dispatcher for Uni-App Framework
async function safeClick(page, elementHandle) {
  if (!elementHandle) return false;
  try {
    await elementHandle.evaluate((el) => {
      ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
        el.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
      });
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Modal Confirmation Handler (.btnConfirm on uni-view)
async function handleModalConfirm(page) {
  await new Promise((res) => setTimeout(res, 1500));
  
  const confirmResult = await page.evaluate(() => {
    const btn = document.querySelector('uni-view.btnConfirm') || 
                document.querySelector('.btnConfirm') ||
                Array.from(document.querySelectorAll('uni-view')).find(
                  (el) => el.innerText && el.innerText.trim().toUpperCase() === 'CONFIRM'
                );
    if (btn) {
      ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
        btn.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
      });
      return true;
    }
    return false;
  });

  if (confirmResult) {
    console.log("✅ [ZENQUANT] Modal confirmation button (.btnConfirm) triggered.");
    await new Promise((res) => setTimeout(res, 2500));
    return true;
  }
  console.warn("⚠️ [ZENQUANT] Settlement modal confirm button not detected.");
  return false;
}

// Read Numeric Available Balance
async function getAvailableBalance(page) {
  return await page.evaluate(() => {
    const balanceNode = document.querySelector('.trade-inject-balance__num');
    return balanceNode ? parseFloat(balanceNode.innerText.trim()) : 0;
  });
}

// Strategy Tab Switcher (Plus vs 3Hours)
async function selectStrategyTab(page, targetName) {
  console.log(`🎯 [ZENQUANT] Selecting '${targetName}' strategy tab...`);
  
  const switched = await page.evaluate((target) => {
    const tabs = Array.from(document.querySelectorAll('.trade-dur'));
    const targetTab = tabs.find((el) => el.innerText && el.innerText.trim().toUpperCase().includes(target));
    
    if (targetTab) {
      const isAlreadyActive = targetTab.classList.contains('trade-dur--on');
      if (!isAlreadyActive) {
        const clickTarget = targetTab.querySelector('span') || targetTab;
        ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
          clickTarget.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
        });
      }
      return true;
    }
    return false;
  }, targetName.toUpperCase());

  await new Promise((res) => setTimeout(res, 2000));
  return switched;
}

// Amount Injector and Confirmation Submit
async function injectAmountAndSubmit(page, amount) {
  const numberInputHandle = await page.$('input.uni-input-input');
  if (!numberInputHandle) return false;

  await numberInputHandle.click({ clickCount: 3 });
  await numberInputHandle.type(amount.toString(), { delay: 100 });
  await page.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, numberInputHandle);

  await new Promise((res) => setTimeout(res, 1200));

  const confirmHandle = await page.$('uni-button.trade-submit');
  if (confirmHandle) {
    await safeClick(page, confirmHandle);
    return true;
  }
  return false;
}

export async function runQuantificationTask() {
  let browser = null;

  const ZEN_PHONE = process.env.ZENQUANT_PHONE;
  const ZEN_PASSWORD = process.env.ZENQUANT_PASSWORD;
  const STEEL_API_KEY = process.env.STEEL_API_KEY;
  const BASE_URL = "https://zenquantai.com";

  if (!ZEN_PHONE || !ZEN_PASSWORD || !STEEL_API_KEY) {
    console.error("❌ [ZENQUANT ERROR] Missing required environment variables: ZENQUANT_PHONE, ZENQUANT_PASSWORD, or STEEL_API_KEY.");
    return;
  }

  try {
    console.log("\n==================================================");
    console.log("🤖 [ZENQUANT] Connecting to Steel.dev remote browser...");
    console.log("==================================================");

    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}`
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // ----------------------------------------------------
    // STEP 1: LOGIN PROCEDURE
    // ----------------------------------------------------
    console.log("🔑 [STEP 1] Navigating to Login Page...");
    await page.goto(`${BASE_URL}/#/pages/login/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    
    console.log("⏳ Waiting for input elements to mount...");
    await page.waitForSelector("input.uni-input-input", { timeout: 30000 });
    await new Promise((res) => setTimeout(res, 2500));

    // Select Country Prefix (+234 Nigeria)
    console.log("🌍 Selecting country prefix (+234)...");
    await page.evaluate(() => {
      const countryRows = Array.from(document.querySelectorAll(".country-list-row"));
      const nigeriaRow = countryRows.find((el) => el.innerText && (el.innerText.includes("Nigeria") || el.innerText.includes("+234")));
      if (nigeriaRow) nigeriaRow.click();
    });
    await new Promise((res) => setTimeout(res, 800));

    // Fill Phone & Password
    console.log("✍️ Entering credentials...");
    const phoneInput = await page.$('input.uni-input-input[type="number"]');
    const passInput = await page.$('input.uni-input-input[type="password"]');

    if (phoneInput && passInput) {
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.type(ZEN_PHONE, { delay: 50 });
      await page.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, phoneInput);

      await new Promise((res) => setTimeout(res, 500));

      await passInput.click({ clickCount: 3 });
      await passInput.type(ZEN_PASSWORD, { delay: 50 });
      await page.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, passInput);
    } else {
      throw new Error("Login inputs not found in DOM.");
    }

    await new Promise((res) => setTimeout(res, 1000));

    // Submit Login Form
    console.log("👆 Submitting Login CTA (.zq-cta)...");
    const loginCta = await page.$('.zq-cta');
    if (loginCta) {
      await safeClick(page, loginCta);
    } else {
      const fallbackBtn = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll("uni-view, uni-button, button")).find(
          (el) => el.innerText && el.innerText.trim().toUpperCase() === "LOGIN"
        );
      });
      const el = await fallbackBtn.asElement();
      if (el) await safeClick(page, el);
    }

    console.log("⏳ Waiting 7 seconds for authentication response...");
    await new Promise((res) => setTimeout(res, 7000));

    // Verification
    if (page.url().includes("login")) {
      console.error("❌ Login failed. Still on login route.");
      await sendTelegram("❌ <b>ZenQuant Bot Error:</b> Login failed. Verify credentials.");
      return;
    }
    console.log("✅ Login successful!");

    // ----------------------------------------------------
    // STEP 2: TRADE ROUTE NAVIGATION
    // ----------------------------------------------------
    console.log("\n📈 [STEP 2] Navigating to Trade Page...");
    await page.goto(`${BASE_URL}/#/pages/UITransaction/trade`, { waitUntil: "domcontentloaded" });
    console.log("⏳ Waiting 5 seconds after page load...");
    await new Promise((res) => setTimeout(res, 5000));

    // ----------------------------------------------------
    // STEP 3: CLAIM CHECK #1 (Top Open Positions)
    // ----------------------------------------------------
    console.log("\n💰 [STEP 3] Checking Top Open Positions Claimable button (.trade-pos__claim)...");
    const topClaimHandle = await page.$('.trade-pos__claim');

    if (topClaimHandle) {
      console.log("🎯 Found Top Claim button. Dispatching tap...");
      await safeClick(page, topClaimHandle);
      await handleModalConfirm(page);

      console.log("🔄 Refreshing page post-claim #1...");
      await page.reload({ waitUntil: "domcontentloaded" });
      console.log("⏳ Waiting 5 seconds after refresh...");
      await new Promise((res) => setTimeout(res, 5000));
    } else {
      console.log("ℹ️ No top open positions claim active.");
    }

    // ----------------------------------------------------
    // STEP 4: CLAIM CHECK #2 (Bottom Active Orders Settlement)
    // ----------------------------------------------------
    console.log("\n💰 [STEP 4] Checking Bottom Settlement button (.uit-order-lists__receive-btn)...");
    const bottomSettlementHandle = await page.$('.uit-order-lists__receive-btn') || 
                                   await page.$('.uit-order-lists__receive-btn-text');

    if (bottomSettlementHandle) {
      console.log("🎯 Found Bottom Settlement button. Dispatching tap...");
      await safeClick(page, bottomSettlementHandle);
      await handleModalConfirm(page);

      console.log("🔄 Refreshing page post-claim #2...");
      await page.reload({ waitUntil: "domcontentloaded" });
      console.log("⏳ Waiting 5 seconds after refresh...");
      await new Promise((res) => setTimeout(res, 5000));
    } else {
      console.log("ℹ️ No bottom active order settlements active.");
    }

    // ----------------------------------------------------
    // STEP 5: BALANCE COMPUTATION & TRADE SIZING
    // ----------------------------------------------------
    const initialRawBalance = await getAvailableBalance(page);
    const usableBalance = Math.floor(initialRawBalance);

    let plusAmount = Math.min(usableBalance, 50);
    let remainingBalance = usableBalance - plusAmount;
    let normalAmount = remainingBalance >= 10 ? remainingBalance : 0;

    console.log(`\n📊 [CALCULATION SUMMARY] Raw Balance: ${initialRawBalance} USD | Plus Target: ${plusAmount} USD | Normal Target: ${normalAmount} USD`);

    let executedPlus = 0;
    let executedNormal = 0;

    // ----------------------------------------------------
    // STEP 6: EXECUTE TRADE 1 (3Hours Plus)
    // ----------------------------------------------------
    if (plusAmount > 0) {
      console.log(`\n🚀 [EXECUTION] Processing 3Hours Plus Trade (${plusAmount} USD)...`);
      await selectStrategyTab(page, "PLUS");

      const plusSuccess = await injectAmountAndSubmit(page, plusAmount);

      if (plusSuccess) {
        executedPlus = plusAmount;
        console.log(`✅ Plus trade submitted successfully! Holding 30 seconds...`);
        await new Promise((res) => setTimeout(res, 30000));

        console.log("🔄 Refreshing site post-Plus trade...");
        await page.reload({ waitUntil: "domcontentloaded" });
        console.log("⏳ Waiting 5 seconds after refresh...");
        await new Promise((res) => setTimeout(res, 5000));
      }
    }

    // ----------------------------------------------------
    // STEP 7: EXECUTE TRADE 2 (3Hours Normal)
    // ----------------------------------------------------
    if (normalAmount >= 10) {
      console.log(`\n🚀 [EXECUTION] Processing 3Hours Normal Trade (${normalAmount} USD)...`);
      await selectStrategyTab(page, "3HOURS");

      const normalSuccess = await injectAmountAndSubmit(page, normalAmount);

      if (normalSuccess) {
        executedNormal = normalAmount;
        console.log(`✅ 3Hours Normal trade submitted successfully! Holding 30 seconds...`);
        await new Promise((res) => setTimeout(res, 30000));

        console.log("🔄 Refreshing site post-Normal trade...");
        await page.reload({ waitUntil: "domcontentloaded" });
        console.log("⏳ Waiting 5 seconds after refresh...");
        await new Promise((res) => setTimeout(res, 5000));
      }
    }

    // ----------------------------------------------------
    // STEP 8: FINAL AUDIT & TELEGRAM NOTIFICATION
    // ----------------------------------------------------
    const finalBalance = await getAvailableBalance(page);
    const expectedUnusedBalance = initialRawBalance - (executedPlus + executedNormal);
    const isMathValid = Math.abs(finalBalance - expectedUnusedBalance) < 0.1;

    console.log(`\n📊 [FINAL VERIFICATION] Ending Balance: ${finalBalance} USD | Expected Unused: ${expectedUnusedBalance.toFixed(2)} USD | Valid: ${isMathValid}`);

    let reportMsg = `🤖 <b>ZenQuant Automated Execution Report</b>\n\n`;
    reportMsg += `💰 <b>Initial Balance:</b> ${initialRawBalance.toFixed(2)} USD\n`;
    reportMsg += `⚡ <b>3Hours Plus Reinvested:</b> ${executedPlus} USD\n`;
    reportMsg += `⚡ <b>3Hours Normal Reinvested:</b> ${executedNormal} USD\n`;
    reportMsg += `💵 <b>Remaining Unused Balance:</b> ${finalBalance.toFixed(2)} USD\n`;
    reportMsg += `STATUS: <b>${isMathValid ? "BALANCED ✅" : "DISCREPANCY DETECTED ⚠️"}</b>`;

    await sendTelegram(reportMsg);

  } catch (err) {
    console.error("\n❌ [CRITICAL TASK ERROR]:", err.message);
    await sendTelegram(`❌ <b>ZenQuant Bot Execution Failed:</b> ${err.message}`);
  } finally {
    if (browser) {
      console.log("⏳ Holding 10 seconds before browser disconnection...");
      await new Promise((res) => setTimeout(res, 10000));
      await browser.disconnect();
      console.log("🔒 Steel.dev browser disconnected cleanly.\n");
    }
  }
}

async function executeTrigger(source = "SCHEDULED") {
  if (isQuantRunning) return false;
  isQuantRunning = true;
  lastQuantRunTime = Date.now();
  console.log(`\n==================================================`);
  console.log(`🚀 TRIGGER INITIATED: ${source}`);
  console.log(`==================================================`);
  try {
    await runQuantificationTask();
  } catch (err) {
    console.error("❌ Execution Trigger Error:", err.message);
  } finally {
    isQuantRunning = false;
  }
}

// Webhook HTTP Server
http.createServer((req, res) => {
  if ((req.url || "/").startsWith("/run-quant")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "ZenQuant manual trigger queued." }));
    executeTrigger("HTTP_WEBHOOK");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ZenQuant Automation Server Active");
}).listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Automated 3-Hour Interval Runner with Self-Ping Keep-Alive
setInterval(async () => {
  const APP_URL = process.env.RENDER_EXTERNAL_URL;
  if (APP_URL) {
    try { await fetch(APP_URL); } catch (_) {}
  }
  if (Date.now() - lastQuantRunTime >= THREE_HOURS_TWO_MINS_MS) {
    executeTrigger("INTERVAL_CRON");
  }
}, 10 * 60 * 1000);

// Boot Trigger
executeTrigger("INITIAL_BOOT");
