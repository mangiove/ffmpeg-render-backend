
import express from "express";
import multer from "multer";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { stat, unlink } from "fs/promises";
import ffmpegPath from "ffmpeg-static";

const app = express();

// 1) Limiti conservativi: /tmp scrivibile, 10 MB per file (alza se ti serve)
const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

console.log("FFmpeg binary:", ffmpegPath);

// --- serializzazione (1 richiesta per volta) ---
let processing = false;

// FFmpeg runner (file -> file) con stderr raccolto
function runFfmpegToFile(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", d => (err += d.toString()));
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exit ${code}`))));
  });
}

app.get("/", (_req, res) => {
  res.status(200).send("Backend pronto - POST /render (fields: image, audio)");
});

app.get("/ffmpeg-selftest", async (_req, res) => {
  const out = `/tmp/self-${Date.now()}.mp4`;
  const args = [
    "-hide_banner","-loglevel","error","-nostdin","-y",
    "-f","lavfi","-i","color=c=black:s=640x360:r=30:d=2",
    "-f","lavfi","-i","sine=frequency=1000:duration=2",
    "-c:v","mpeg4","-pix_fmt","yuv420p","-r","30","-threads","1",
    "-c:a","libmp3lame",
    "-movflags","+faststart",
    out
  ];
  try {
    await runFfmpegToFile(args);
    const s = await stat(out);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(s.size));
    createReadStream(out)
      .on("close", () => unlink(out).catch(()=>{}))
      .pipe(res);
  } catch (e) {
    res.status(500).type("text/plain").send("SELFTEST failed:\n" + e.message);
  }
});

app.post("/render", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  if (processing) {
    return res.status(429).type("text/plain").send("Server occupato: riprova tra pochi secondi");
  }
  processing = true;

  try {
    const img = req.files.image?.[0];
    const aud = req.files.audio?.[0];
    if (!img || !aud) {
      processing = false;
      return res.status(400).type("text/plain").send("Missing image or audio");
    }

    const out = `/tmp/out-${Date.now()}.mp4`;

    // 2) Profilo leggero e robusto per Free tier:
    //    - scala max 720p
    //    - mpeg4 + libmp3lame
    //    - threads=1, very low memory footprint
    const args = [
      "-hide_banner","-loglevel","error","-nostdin","-y",
      "-loop","1","-framerate","1",
      "-i", img.path,
      "-i", aud.path,
      "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
      "-c:v","mpeg4",
      "-pix_fmt","yuv420p",
      "-r","30",
      "-threads","1",
      "-c:a","libmp3lame",
      "-movflags","+faststart",
      "-shortest",
      out
    ];

    try {
      await runFfmpegToFile(args);
    } catch (e) {
      console.error("FFmpeg failed:", e.message);
      // pulizia input
      await Promise.allSettled([unlink(img.path), unlink(aud.path)]);
      processing = false;
      return res.status(500).type("text/plain").send("FFmpeg failed:\n" + e.message);
    }

    // 3) STREAMING: nessun buffer gigante in RAM
    const s = await stat(out);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(s.size));

    const rs = createReadStream(out);
    rs.on("close", async () => {
      await Promise.allSettled([unlink(img.path), unlink(aud.path), unlink(out)]);
      processing = false;
      console.log("Output size(bytes):", s.size);
    });
    rs.pipe(res);
  } catch (e) {
    processing = false;
    console.error("Server error:", e);
    res.status(500).type("text/plain").send("Server error: " + e.message);
  }
});

app.listen(3000, () => console.log("Render backend running on 3000"));
