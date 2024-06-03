const express = require("express");
var cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const dotenv = require("dotenv");
const { error } = require("console");
dotenv.config();

// import OpenAI from "openai";
const OpenAI = require("openai").default;

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"], // This is the default and can be omitted
});

const knex = require("knex")({
  client: "pg",
  connection: process.env.DATABASE_URL,
});

const app = express();
app.use(cors());
app.options("*", cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
let keepAlive;

const setupDeepgram = (socket, user_interview, interview) => {
  console.log("Starting with ", user_interview, interview);
  const deepgram = deepgramClient.listen.live({
    language: "en",
    punctuate: true,
    smart_format: true,
    model: "nova-2-conversationalai",
    filler_words: true,
    interim_results: true,
  });
  let runningTranscript = "";
  let lastMessageTime = new Date();
  let lastkeepalive = new Date();
  let isAiWorking = false;
  let init = true;
  let messages = [
    {
      role: "system",
      content:
        "You will be talking with " +
        user_interview.name +
        " \n" +
        interview.system_prompt,
    },
  ];

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    try {
      const minKeepAliveDiff = 9 * 1000;
      const lastKeepAliveTimeDiff = new Date() - lastkeepalive; // this returns the difference in milliseconds
      if (lastKeepAliveTimeDiff > minKeepAliveDiff) {
        console.log("deepgram: keepalive");

        deepgram.keepAlive();
        lastkeepalive = new Date();
      }
      if (shouldReturnResponse()) {
        isAiWorking = true;
        console.log("Getting AI");
        socket.emit("transcript", runningTranscript);
        getAiResponse(runningTranscript);
        runningTranscript = "";
        lastMessageTime = new Date();
      }
      if (isAiWorking == true) {
        runningTranscript = "";
        lastMessageTime = new Date();
      }
    } catch (error) {
      console.error(error);
    }
  }, 1 * 500);

  let onCloseFunc = async () => {
    if (messages.length < 3) {
      console.log("NO INTERVIEW ENDING EARLY", messages);
      return;
    }
    console.log("Saving transcript", messages);

    await knex("user_interviews")
      .where({ id: user_interview.id })
      .update({ transcript: JSON.stringify(messages) });

    const feedback = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: interview.feedback_prompt,
        },
        {
          role: "user",
          content: "Transcript: \n" + JSON.stringify(messages),
        },
      ],
    });
    console.log("Feedback", feedback.choices[0]?.message.content);
    await knex("user_interviews")
      .where({ id: user_interview.id })
      .update({ feedback: feedback.choices[0]?.message.content || "" });
  };

  const shouldReturnResponse = () => {
    if (runningTranscript == "") return false;
    const minMillSecondsDiff = 4 * 500;
    const lastMessageTimeDiff = new Date() - lastMessageTime; // this returns the difference in milliseconds
    console.log("lastMessageTimeDiff", lastMessageTimeDiff, lastMessageTime);
    return lastMessageTimeDiff > minMillSecondsDiff;
  };

  const getAiResponse = async (content) => {
    console.log("init", init);
    if (!init && content) {
      messages.push({ role: "user", content: content });
    } else if (init) {
      init = false;
    } else {
      return;
    }

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      stream: true,
    });
    let aiText = "";
    for await (const chunk of stream) {
      socket.emit("ai", {
        content: chunk.choices[0]?.delta?.content || "",
        isDone: false,
      });
      aiText += chunk.choices[0]?.delta?.content || "";
    }
    socket.emit("ai", { content: "", isDone: true });
    messages.push({ role: "assistant", content: aiText });
    getAiVoiceResponse(aiText);
  };
  getAiResponse("");

  const getAiVoiceResponse = async (text) => {
    const url = "https://api.deepgram.com";
    const model = "aura-asteria-en";
    const start = Date.now();

    text = text
      .replaceAll("¡", "")
      .replaceAll("https://", "")
      .replaceAll("http://", "")
      .replaceAll(".com", " dot com")
      .replaceAll(".org", " dot org")
      .replaceAll(".co.uk", " dot co dot UK")
      .replaceAll(/```[\s\S]*?```/g, "\nAs shown on the app.\n")
      .replaceAll(
        /([a-zA-Z0-9])\/([a-zA-Z0-9])/g,
        (match, precedingText, followingText) => {
          return precedingText + " forward slash " + followingText;
        }
      );

    await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
      method: "POST",
      body: JSON.stringify({ text }),
      headers: {
        "Content-Type": `application/json`,
        Authorization: `token ${process.env.DEEPGRAM_API_KEY || ""}`,
      },
    })
      .then(async (response) => {
        const headers = new Headers();
        headers.set("Content-Type", "audio/mp3");

        if (!response?.body) {
          console.error("No response body");
          return;
        }

        // Get the audio data as a buffer
        const audioData = await response.arrayBuffer();

        // Emit the audio data to the client using Socket.IO
        socket.emit("aiVoice", audioData);
        isAiWorking = false;
      })
      .catch((error) => {
        console.error(error || error?.message);
      });
  };

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("deepgram: connected");

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log("deepgram: disconnected");
      clearInterval(keepAlive);

      try {
        deepgram.finish();
      } catch (error) {
        console.error(error);
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
      console.log("deepgram: error recieved");
      console.error(error);
    });

    deepgram.addListener(LiveTranscriptionEvents.Warning, async (warning) => {
      console.log("deepgram: warning recieved");
      console.warn(warning);
    });

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript ?? "";
      console.log("transcript", transcript);
      if (transcript !== "") {
        lastMessageTime = new Date();
        if (data.is_final) runningTranscript += " " + transcript;
      }

      socket.emit("data", data);
    });

    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("deepgram: packet received");
      console.log("deepgram: metadata received");
      console.log("socket: metadata sent to client");
      socket.emit("metadata", data);
    });
  });

  return { deepgram, onCloseFunc };
};

const getInterviewDetails = async (userInterviewId) => {
  const user_interview = await knex("user_interviews")
    .select("*")
    .where({ id: userInterviewId })
    .first();
  const interview = await knex("interviews")
    .select("*")
    .where({ id: user_interview.interview_id })
    .first();
  return { user_interview, interview };
};

io.on("connection", (socket) => {
  console.log("socket: client connected");
  let deepgram;
  let onCloseFunc;
  let started = false;
  let user_interview;
  let interview;
  socket.on("start-interview", (data) => {
    if (!started) {
      (async () => {
        const interviews = await getInterviewDetails(data.userInterviewId);
        user_interview = interviews.user_interview;
        interview = interviews.interview;
        deepgramObj = setupDeepgram(socket, user_interview, interview);
        deepgram = deepgramObj.deepgram;
        onCloseFunc = deepgramObj.onCloseFunc;
        console.log("user_interview", user_interview);
        socket.emit("name-set", user_interview.name);
      })();
    }
  });

  socket.on("packet-sent", (data) => {
    if (!deepgram) {
      return;
    }
    if (deepgram.getReadyState() === 1 /* OPEN */) {
      deepgram.send(data);
    } else if (deepgram.getReadyState() >= 2 /* 2 = CLOSING, 3 = CLOSED */) {
      console.log("socket: data couldn't be sent to deepgram");
      console.log("socket: retrying connection to deepgram");
      /* Attempt to reopen the Deepgram connection */
      // try {
      //   deepgram.finish();
      //   deepgram.removeAllListeners();
      //   deepgramObj = setupDeepgram(socket, user_interview, interview);
      //   deepgram = deepgramObj.deepgram;
      //   onCloseFunc = deepgramObj.onCloseFunc;
      // } catch (error) {
      //   console.error(error);
      // }
    } else {
      console.log("socket: data couldn't be sent to deepgram");
    }
  });

  socket.on("end-interview", () => {
    onCloseFunc();
  });

  socket.on("disconnect", () => {
    console.log("socket: client disconnected");
    clearInterval(keepAlive);

    try {
      deepgram.finish();
      deepgram.removeAllListeners();
      deepgram = null;
    } catch (error) {
      console.error(error);
    }
  });
});

// rest POST request to create interview in interviewing table
app.post("/interviews", async (req, res) => {
  // check authorization header
  // const auth = req.headers.authorization;
  // if (auth !== "Bearer bear") {
  //   console.log(req.headers);
  //   return res.status(401).json({ message: "Unauthorized" });
  // }

  try {
    const data = req?.body;
    console.log(data);
    const [interview] = await knex("interviews").insert(data).returning("*");
    res.json(interview);
  } catch (e) {
    console.log(e);
    res.json(e);
  }
});

// rest get request
app.get("/interviews", async (req, res) => {
  // check authorization header
  // const auth = req.headers.authorization;
  // if (auth !== "Bearer bear") {
  //   return res.status(401).json({ message: "Unauthorized" });
  // }
  const interviews = await knex("interviews").select("*");
  res.json(interviews);
});

app.get("/userinterviews/:id", async (req, res) => {
  // check authorization header

  const interview = await knex("user_interviews")
    .select("*")
    .where({ id: req.params.id })
    .first();
  res.json(interview);
});

app.get("/userinterviews/", async (req, res) => {
  // check authorization header

  const interviews = await knex("user_interviews").select("*");
  res.json(interviews);
});

app.post("/userinterviews", async (req, res) => {
  // check authorization header

  const data = req.body;
  const [interview] = await knex("user_interviews").insert(data).returning("*");
  res.json(interview);
});

// rest patch request
app.patch("/interviews/:id", async (req, res) => {
  // check authorization header
  // const auth = req.headers.authorization;
  // if (auth !== "Bearer bear") {
  //   return res.status(401).json({ message: "Unauthorized" });
  // }
  const { id } = req.params;
  const data = req.body;
  const [interview] = await knex("interviews")
    .where({ id })
    .update(data)
    .returning("*");
  res.json(interview);
});

process.on("SIGINT", () => {
  knex.destroy().then(() => {
    console.log("Database connection closed");
    process.exit(0);
  });
});

// listen on environment port or 3000
server.listen(process.env.PORT || 3000, () => {
  console.log("listening on localhost:" + process.env.PORT || 3000);
});
