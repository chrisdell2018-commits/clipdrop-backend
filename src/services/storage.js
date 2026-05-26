const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const BUCKET = process.env.S3_BUCKET;

// ─── Upload a local file path to S3 ───────────────────────────────
async function uploadFile(localPath, folder = "originals", mimeType = "video/mp4") {
  const fs = require("fs");
  const key = `${folder}/${uuidv4()}-${Date.now()}.mp4`;

  await s3.upload({
    Bucket: BUCKET,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: mimeType,
  }).promise();

  return key;
}

// ─── Upload a buffer directly ──────────────────────────────────────
async function uploadBuffer(buffer, folder = "clips", mimeType = "video/mp4") {
  const key = `${folder}/${uuidv4()}-${Date.now()}.mp4`;

  await s3.upload({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }).promise();

  return key;
}

// ─── Generate a signed URL (for reading / platform APIs to pull from)
function getSignedUrl(key, expiresInSeconds = 3600) {
  return s3.getSignedUrl("getObject", {
    Bucket: BUCKET,
    Key: key,
    Expires: expiresInSeconds,
  });
}

// ─── Get a public URL (only if bucket has public-read on this prefix)
function getPublicUrl(key) {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ─── Delete a file ─────────────────────────────────────────────────
async function deleteFile(key) {
  await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();
}

module.exports = { uploadFile, uploadBuffer, getSignedUrl, getPublicUrl, deleteFile };
