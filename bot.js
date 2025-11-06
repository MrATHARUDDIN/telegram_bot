const express = require("express");
const fs = require("fs").promises;
const TelegramBot = require("node-telegram-bot-api");

// === CONFIG ===
const PORT = process.env.PORT || 4040;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8482145476:AAGnV_DR2vvERiwDDrSgd3HGnWjLFGEQPTE";

const app = express();
app.use(express.json());
const userEmails = {};
const userStates = {}; // ✅ Moved to top so ALL features can use it

// === TELEGRAM BOT ===
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// === Helper: read matches ===
async function readMatches() {
  const data = await fs.readFile("matches.json", "utf8");
  const json = JSON.parse(data);
  return json.matches;
}

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["/upcoming", "/finished"],
      ["/prediction"], ["/mypredictions"],
      ["/allpredictions"]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// === Express routes ===
app.get("/", (req, res) => res.send("GET request to the homepage"));

app.get("/matches", async (req, res) => {
  try {
    const matches = await readMatches();
    res.json(matches);
  } catch (error) {
    console.error("Error reading matches.json:", error);
    res.status(500).json({ error: "Failed to load match data." });
  }
});

// === START COMMAND (Email Input Fix) ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    "Welcome! ⚽\n\nPlease enter your email address to continue:"
  );

  userStates[chatId] = { step: "enter_email" }; // ✅ Track email step
});

// === Global Message Handler (Email + Prediction Flow) ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = userStates[chatId];

  // Ignore other commands while inside the email step
  if (text.startsWith("/") && state?.step === "enter_email") return;

  // ✅ Email entry step
  if (state?.step === "enter_email") {
    const email = text.trim();

    if (!/\S+@\S+\.\S+/.test(email)) {
      return bot.sendMessage(chatId, "❌ Invalid email. Try again:");
    }

    userEmails[chatId] = email;
    delete userStates[chatId]; // clear email state

    return bot.sendMessage(
      chatId,
      `✅ Thanks, ${email} saved!\n\nAvailable commands:\n/upcoming\n/finished\n/prediction`,
      mainKeyboard
    );
  }

  // ✅ If no state, ignore this handler
  if (!state) return;

  // === Prediction Match Selection ===
  if (state.step === "choose_match") {
    const index = parseInt(text) - 1;
    if (isNaN(index) || index < 0 || index >= state.matches.length) {
      return bot.sendMessage(chatId, "❌ Invalid choice. Send a valid match number.", mainKeyboard);
    }

    state.selectedMatch = state.matches[index];
    state.step = "enter_score";

    return bot.sendMessage(
      chatId,
      `You selected:\n${state.selectedMatch.homeTeam} vs ${state.selectedMatch.awayTeam}\n\nSend your prediction like: 2-1`,
      mainKeyboard
    );
  }

  // === Prediction Score Entry ===
  if (state.step === "enter_score") {
    const parts = text.split("-");
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      return bot.sendMessage(chatId, "❌ Invalid score. Example: 2-1", mainKeyboard);
    }

    const prediction = {
      user: msg.from.username || msg.from.first_name,
      match: `${state.selectedMatch.homeTeam} vs ${state.selectedMatch.awayTeam}`,
      date: state.selectedMatch.date,
      prediction: { home: parseInt(parts[0]), away: parseInt(parts[1]) },
    };

    try {
      let existing = [];
      try {
        const data = await fs.readFile("predictions.json", "utf8");
        existing = JSON.parse(data);
      } catch {}
      existing.push(prediction);
      await fs.writeFile("predictions.json", JSON.stringify(existing, null, 2));

      bot.sendMessage(
        chatId,
        `✅ Prediction saved:\n${prediction.match}\n${prediction.prediction.home} - ${prediction.prediction.away}`,
        mainKeyboard
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Failed to save prediction.", mainKeyboard);
    }

    delete userStates[chatId];
  }
});

// === Upcoming Matches ===
bot.onText(/\/upcoming/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const matches = await readMatches();
    const now = new Date();

    const upcoming = matches.filter(m => new Date(m.date) >= now && m.status === "UPCOMING");

    if (upcoming.length === 0) {
      return bot.sendMessage(chatId, "No upcoming matches ⚽", mainKeyboard);
    }

    const message = upcoming
      .map(m =>
        `🏟️ ${m.homeTeam} vs ${m.awayTeam}\n📅 ${m.date}`
      )
      .join("\n\n");

    bot.sendMessage(chatId, message, mainKeyboard);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading upcoming matches ❌", mainKeyboard);
  }
});

// === Finished Matches ===
bot.onText(/\/finished/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const matches = await readMatches();
    const now = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(now.getDate() - 7);

    const finished = matches.filter(m => {
      const matchDate = new Date(m.date);
      return matchDate >= lastWeek && matchDate <= now && m.status === "FINISHED";
    });

    if (finished.length === 0) {
      return bot.sendMessage(chatId, "No finished matches in the last week 🏁", mainKeyboard);
    }

    const message = finished
      .map(m =>
        `✅ ${m.homeTeam} vs ${m.awayTeam}\n📅 ${m.date}\n🏁 ${m.score.home} - ${m.score.away}`
      )
      .join("\n\n");

    bot.sendMessage(chatId, message, mainKeyboard);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading finished matches ❌", mainKeyboard);
  }
});

// === User predictions ===
bot.onText(/\/prediction/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const matches = await readMatches();
    const now = new Date();

    const futureMatches = matches.filter(m => new Date(m.date) >= now && m.status === "UPCOMING");

    if (futureMatches.length === 0) {
      return bot.sendMessage(chatId, "No future matches available for prediction ⚽", mainKeyboard);
    }

    userStates[chatId] = { step: "choose_match", matches: futureMatches };

    const matchList = futureMatches
      .map((m, i) => `${i + 1}. ${m.homeTeam} vs ${m.awayTeam} (${m.date})`)
      .join("\n");

    bot.sendMessage(
      chatId,
      `🔮 Choose a match to predict by sending its number:\n\n${matchList}`,
      mainKeyboard
    );
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading matches ❌", mainKeyboard);
  }
});

// === View user's predictions ===
bot.onText(/\/mypredictions/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;

  try {
    let predictions = [];
    try {
      const data = await fs.readFile("predictions.json", "utf8");
      predictions = JSON.parse(data);
    } catch {
      predictions = [];
    }

    const userPredictions = predictions.filter(p => p.user === username);

    if (userPredictions.length === 0) {
      return bot.sendMessage(chatId, "You have no predictions yet ⚽", mainKeyboard);
    }

    const message = userPredictions
      .map(p => `🔮 ${p.match} on ${p.date}\nPrediction: ${p.prediction.home} - ${p.prediction.away}`)
      .join("\n\n");

    bot.sendMessage(chatId, message, mainKeyboard);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Failed to load your predictions.", mainKeyboard);
  }
});

// === Show all predictions ===
bot.onText(/\/allpredictions/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const data = await fs.readFile("predictions.json", "utf8");
    const predictions = JSON.parse(data);

    if (!predictions.length) {
      return bot.sendMessage(chatId, "No predictions have been made yet ⚽", mainKeyboard);
    }

    const grouped = {};
    predictions.forEach(p => {
      if (!grouped[p.match]) grouped[p.match] = [];
      grouped[p.match].push(`${p.user}: ${p.prediction.home}-${p.prediction.away}`);
    });

    const message = Object.entries(grouped)
      .map(([match, preds]) => `🏟️ ${match}\n${preds.join("\n")}`)
      .join("\n\n");

    bot.sendMessage(chatId, message, mainKeyboard);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Failed to load all predictions.", mainKeyboard);
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
