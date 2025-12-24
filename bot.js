const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const puppeteer = require("puppeteer");
const Jimp = require("jimp");
const QrCode = require("qrcode-reader");

// Configuration from your provided text
const apiId = 21308078;
const apiHash = "e3e498ddaf9789e550dd112b8a6bbb5b";
const loginPhone = "+66930744496";
const claimingPhoneNumber = "0840525643"; // เบอร์รับซอง

const stringSession = new StringSession(""); // You can save the session string later to avoid re-login

const processedMsg = new Set();

async function redeemAngpaoPuppeteer(voucherHash, phone) {
  const url = `https://gift.truemoney.com/campaign/vouchers/${voucherHash}/redeem`;
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.goto(`https://gift.truemoney.com/campaign/?v=${voucherHash}`, { waitUntil: "networkidle2", timeout: 10000 });

  const result = await page.evaluate(async (url, phone, voucherHash) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile: phone, voucher_hash: voucherHash })
    });
    return await res.json();
  }, url, phone, voucherHash);

  await browser.close();
  return result;
}

(async () => {
  console.log("กำลังเริ่มต้นใช้งาน Telegram...");
  
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: loginPhone,
    password: async () => await input.text("Please enter your password (if 2FA enabled): "),
    phoneCode: async () => await input.text("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("เข้าสู่ระบบ Telegram สำเร็จ!");
  console.log("Session String (บันทึกเก็บไว้ใช้ครั้งหน้าได้):", client.session.save());

  client.addEventHandler(async (event) => {
    const message = event.message;
    const chatId = message.chatId ? message.chatId.toString() : "unknown";

    // ป้องกันการ process ซ้ำ (ถ้ามี ID)
    if (message.id && processedMsg.has(message.id)) return;
    if (message.id) processedMsg.add(message.id);

    // 1. ตรวจสอบข้อความ Text (Link)
    if (message.text) {
      const match = message.text.match(/v=([0-9A-Za-z]{35})/);
      if (match) {
        const voucherHash = match[1];
        console.log(`[Text] เจอลิ้งค์อั่งเปาจาก ${chatId} กำลังดำเนินการ...`);
        try {
          const result = await redeemAngpaoPuppeteer(voucherHash, claimingPhoneNumber);
          if (result?.status?.code === "SUCCESS") {
            const amount = result?.data?.my_ticket?.amount_baht;
            console.log(`รับอั่งเปาสำเร็จ: ${amount} บาท จาก ${chatId}`);
            // ส่งข้อความตอบกลับถ้าต้องการ
            // await client.sendMessage(chatId, { message: `รับอั่งเปาสำเร็จ: ${amount} บาท` });
          } else {
            console.log(`ไม่สำเร็จ: ${result?.status?.message || "Unknown error"}`, chatId);
          }
        } catch (e) {
          console.error("เกิดข้อผิดพลาดในการรับซอง (Text):", e);
        }
      }
    }

    // 2. ตรวจสอบรูปภาพ (QR Code)
    if (message.media && message.media.photo) {
      try {
        const buffer = await client.downloadMedia(message.media);
        if (!buffer || buffer.length === 0) return;

        const image = await Jimp.read(buffer);
        const qr = new QrCode();
        
        qr.callback = async function (err, value) {
          if (err || !value) {
             // ไม่ใช่ QR หรืออ่านไม่ออก
             return;
          }
          const found = value.result.match(/v=([0-9A-Za-z]{35})/);
          if (found) {
            const voucherHash = found[1];
            console.log(`[QR] เจอลิ้งค์อั่งเปาจาก ${chatId} กำลังดำเนินการ...`);
            try {
              const result = await redeemAngpaoPuppeteer(voucherHash, claimingPhoneNumber);
              if (result?.status?.code === "SUCCESS") {
                const amount = result?.data?.my_ticket?.amount_baht;
                console.log(`รับอั่งเปาสำเร็จ: ${amount} บาท จาก ${chatId}`);
                await client.sendMessage(chatId, { message: `รับอั่งเปาสำเร็จ: ${amount} บาท` });
              } else {
                console.log(`ไม่สำเร็จ: ${result?.status?.message || "Unknown error"}`, chatId);
              }
            } catch (e) {
              console.error("เกิดข้อผิดพลาดในการรับซอง (QR):", e);
            }
          }
        };
        qr.decode(image.bitmap);
      } catch (e) {
        console.error("เกิดข้อผิดพลาดในการอ่านรูปภาพ:", e);
      }
    }

  }, new NewMessage({}));
})();
