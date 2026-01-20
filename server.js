
import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import { readFile, unlink, stat } from "fs/promises";
import ffmpegPath from "ffmpeg-static";

const app = express();
const upload = multer({ dest: "/tmp" });

console.log("FFmpeg binary:", ffmpegPath);

// helper: esegue ffmpeg e restituisce stdout/stderr
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) {
        err.stderr = (stderr || "").toString();
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Endpoint diagnostico: mostra prime 80 righe di `ffmpeg -codecs`
app.get("/ffmpeg-info", async (_req, res) => {
  try {
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ["-version"], (e, out, er) => (e ? reject(e) : resolve({ out, er })));
    });
    execFile(ffmpegPath, ["-hide_banner", "-codecs"], (e, out, er) => {
      if (e) return res.status(500).send("ffmpeg error: " + (er || e.message));
      const lines = out.toString().split("\n").slice(0, 80).join("\n");
      res.type("text/plain").send(lines);
    });
  } catch (e) {
    res.status(500).send("ffmpeg not runnable: " + e.message);
  }
});

// Endpoint diagnostico: genera un mp4 di 2 secondi con sorgenti sintetiche
app.get("/ffmpeg-selftest", async (_req, res) => {
  const out = `/tmp/selftest-${Date.now()}.mp4`;
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=2",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
    "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac",
    "-movflags", "+faststart",
    out
  ];
  try {
    await runFfmpeg(args);
    const data = await readFile(out);
    await unlink(out).catch(() => {});
    res.type("video/mp4").send(data);
  } catch (e) {
    res.status(500).type("text/plain").send("SELFTEST failed:\n" + (e.stderr || e.message));
  }
});

app.post("/render", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const img = req.files.image?.[0];
    const aud = req.files.audio?.[0];

    console.log("Incoming /render");
    console.log("image:", img?.path, "audio:", aud?.path);

    if (!img || !aud) {
      return res.status(400).send("Missing image or audio");
    }

    const out = `/tmp/out-${Date.now()}.mp4`;

    // Tentativo #1: H.264 + AAC
    let args = [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-y",
      "-loop", "1",
      "-framerate", "1",
      "-i", img.path,
      "-i", aud.path,
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      out
    ];

    console.log("FFmpeg args (try #1 H.264):", args.join(" "));
    try {
      await runFfmpeg(args);
    } catch (e1) {
      console.error("FFmpeg error (H.264):\n" + (e1.stderr || e1.message));

      // Tentativo #2: MPEG4 + AAC
      args = [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-y",
        "-loop", "1",
        "-framerate", "1",
        "-i", img.path,
        "-i", aud.path,
        "-c:v", "mpeg4",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-shortest",
        out
      ];
      console.log("FFmpeg args (try #2 MPEG4+AAC):", args.join(" "));
      try {
        await runFfmpeg(args);
      } catch (e2) {
        console.error("FFmpeg error (MPEG4+AAC):\n" + (e2.stderr || e2.message));

        // Tentativo #3: MPEG4 + MP3 (fallback audio)
        args = [
          "-hide_banner", "-loglevel", "error", "-nostdin",
          "-y",
          "-loop", "1",
          "-framerate", "1",
          "-i", img.path,
          "-i", aud.path,
          "-c:v", "mpeg4",
          "-pix_fmt", "yuv420p",
          "-r", "30",
          "-c:a", "libmp3lame",
          "-movflags", "+faststart",
          "-shortest",
          out
        ];
        console.log("FFmpeg args (try #3 MPEG4+MP3):", args.join(" "));
        try {
          await runFfmpeg(args);
        } catch (e3) {
          console.error("FFmpeg error (MPEG4+MP3):\n" + (e3.stderr || e3.message));
          await Promise.allSettled([unlink(img.path), unlink(aud.path)]);
          return res.status(500).type("text/plain").send(
            "FFmpeg failed:\n" + (e3.stderr || e3.message)
          );
        }
      }
    }

    // Verifica dimensione output
    const s = await stat(out);
    console.log("Output size(bytes):", s.size);

    const data = await readFile(out);
    await Promise.allSettled([unlink(img.path), unlink(aud.path), unlink(out)]);

    res.setHeader("Content-Type", "video/mp4");
    return res.send(data);

  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).type("text/plain").send("Server error: " + e.message);
  }
});

app.get("/", (_req, res) => {
  res.status(200).send("Backend pronto - POST /render (fields: image, audio)");
});

app.listen(3000, () => console.log("Render backend running on 3000"));
