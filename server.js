
import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import { readFile, unlink, stat } from "fs/promises";
import ffmpegPath from "ffmpeg-static";

const app = express();
const upload = multer({ dest: "/tmp" });

// Log di boot
console.log("FFmpeg binary:", ffmpegPath);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr?.toString();
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

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

    // Primo tentativo: H.264 + AAC
    let args = [
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

    try {
      console.log("FFmpeg args (try #1 H.264):", args.join(" "));
      await runFfmpeg(args);
    } catch (e1) {
      console.error("FFmpeg error (H.264):", e1.stderr || e1.message);

      // Fallback: MPEG4 + AAC (encoder spesso sempre presente)
      args = [
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
      console.log("FFmpeg args (try #2 MPEG4):", args.join(" "));
      try {
        await runFfmpeg(args);
      } catch (e2) {
        console.error("FFmpeg error (MPEG4):", e2.stderr || e2.message);
        // Pulizia e risposta di errore dettagliata
        await Promise.allSettled([unlink(img.path), unlink(aud.path)]);
        return res.status(500).send("FFmpeg failed:\n" + (e2.stderr || e2.message));
      }
    }

    // Verifica dimensione file
    const st = await stat(out);
    console.log("Output size(bytes):", st.size);

    const data = await readFile(out);

    // Pulizia
    await Promise.allSettled([unlink(img.path), unlink(aud.path), unlink(out)]);

    res.setHeader("Content-Type", "video/mp4");
    return res.send(data);

  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).send("Server error: " + e.message);
  }
});

app.get("/", (_req, res) => {
  res.status(200).send("Backend pronto - POST /render con fields image + audio");
});

app.listen(3000, () => console.log("Backend pronto sulla porta 3000"));
