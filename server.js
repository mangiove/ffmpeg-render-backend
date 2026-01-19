
import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import path from "path";

const app = express();
const upload = multer({ dest: "uploads/" });

app.post("/render", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const img = req.files.image[0];
    const aud = req.files.audio[0];

    const output = `output-${Date.now()}.mp4`;

    // Comando FFmpeg: immagine fissa + audio → MP4
    const args = [
      "-loop", "1",
      "-i", img.path,
      "-i", aud.path,
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      output
    ];

    execFile("ffmpeg", args, async (err) => {
      if (err) return res.status(500).send("Errore FFmpeg: " + err);

      const data = await readFile(output);

      // Pulisci file temporanei
      await unlink(img.path);
      await unlink(aud.path);
      await unlink(output);

      res.setHeader("Content-Type", "video/mp4");
      res.send(data);
    });
  } catch (e) {
    res.status(500).send("Errore server: " + e.message);
  }
});

app.listen(3000, () => console.log("Backend pronto sulla porta 3000"));
