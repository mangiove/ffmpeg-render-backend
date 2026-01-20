
import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import { readFile, unlink } from "fs/promises";
import ffmpegPath from "ffmpeg-static"; // <— percorso binario statico

const app = express();
const upload = multer({ dest: "/tmp" }); // /tmp è scrivibile

app.post("/render", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const img = req.files.image?.[0];
    const aud = req.files.audio?.[0];
    if (!img || !aud) return res.status(400).send("Missing image or audio");

    const output = `/tmp/out-${Date.now()}.mp4`;
    const args = [
      "-y",
      "-loop", "1",
      "-i", img.path,
      "-i", aud.path,
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      output
    ];

    execFile(ffmpegPath, args, async (err, _stdout, stderr) => {
      try {
        if (err) {
          console.error("FFmpeg error:", err, stderr);
          return res.status(500).send("FFmpeg error");
        }
        const data = await readFile(output);
        await Promise.allSettled([unlink(img.path), unlink(aud.path), unlink(output)]);
        res.setHeader("Content-Type", "video/mp4");
        res.send(data);
      } catch (e) {
        console.error("Server error:", e);
        res.status(500).send("Server error");
      }
    });
  } catch (e) {
    console.error("Unexpected error:", e);
    res.status(500).send("Server error");
  }
});

app.get("/", (_req, res) => {
  res.status(200).send("Backend pronto - POST /render accetta multipart image+audio");
});
app.listen(3000, () => console.log("Backend pronto sulla porta 3000"));
