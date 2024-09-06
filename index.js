const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const fileTypeModule = require('file-type');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto'); // Benzersiz dosya adı için
const fs = require('fs');
const stream = require('stream');
const path = require('path');

const app = express();
const port = 3000;

app.get('/resize', async (req, res) => {
    const { url, maxWidth, maxHeight } = req.query;

    if (!url) {
        return res.status(400).send('Lütfen bir URL parametresi sağlayın');
    }

    try {
        // Fotoğrafı URL'den çek
        const response = await axios({
            url,
            responseType: 'arraybuffer'
        });

        let imageBuffer = response.data;

        // Buffer'dan MIME türünü kontrol et
        const mimeInfo = await fileTypeModule.fromBuffer(imageBuffer);

        if (!mimeInfo) {
            return res.status(400).send('Desteklenmeyen dosya formatı.');
        }

        const mimeType = mimeInfo.mime;
        console.log('MIME türü:', mimeType);

        // HEIC/HEIF formatında mı kontrol et
        if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            try {
                imageBuffer = await heicConvert({
                    buffer: imageBuffer, // HEIC buffer
                    format: 'JPEG',      // JPEG formatına dönüştür
                    quality: 1           // En yüksek kalite
                });

                console.log('HEIC dosyası başarıyla dönüştürüldü');
            } catch (heicError) {
                console.error('HEIC dönüştürme hatası:', heicError);
                return res.status(500).send('HEIC dosyası dönüştürülemedi.');
            }
        } else {
            console.log('HEIC formatında değil, doğrudan işleme devam ediliyor.');
        }

        let image = sharp(imageBuffer);

        // maxWidth ve maxHeight varsa bunlara göre resize işlemi yap
        if (maxWidth || maxHeight) {
            image = image.resize({
                width: maxWidth ? parseInt(maxWidth) : null,
                height: maxHeight ? parseInt(maxHeight) : null,
                fit: sharp.fit.inside,
                withoutEnlargement: true
            });
        }

        // JPEG formatına dönüştürme işlemi, kalite %50
        image = image.jpeg({ quality: 50 });

        // Görüntüyü buffer olarak alın ve client'a geri gönderin
        const buffer = await image.toBuffer();
        res.set('Content-Type', 'image/jpeg');
        res.send(buffer);

    } catch (error) {
        console.error('Fotoğraf işleme hatası:', error);
        res.status(500).send('Fotoğraf işleme hatası');
    }
});

// Yeni video thumbnail endpoint'i - İlk kareyi alır
app.get('/video-thumbnail', async (req, res) => {
    const { videoUrl, maxWidth, maxHeight } = req.query;

    if (!videoUrl) {
        return res.status(400).send('Lütfen bir video URL parametresi sağlayın');
    }

    try {
        // Benzersiz bir dosya adı oluşturmak için random bir ID kullanıyoruz
        const uniqueFileName = crypto.randomBytes(16).toString('hex') + '.jpg';
        const tempFilePath = path.join(__dirname, uniqueFileName);

        // ffmpeg ile videonun ilk karesinden (0. saniye) thumbnail oluşturuyoruz
        ffmpeg(videoUrl)
            .on('end', async () => {
                // Eğer boyutlandırma parametreleri varsa sharp ile yeniden boyutlandırıyoruz
                if (maxWidth || maxHeight) {
                    try {
                        const resizedImage = await sharp(tempFilePath)
                            .resize({
                                width: maxWidth ? parseInt(maxWidth) : null,
                                height: maxHeight ? parseInt(maxHeight) : null,
                                fit: sharp.fit.contain,
                            })
                            .toBuffer();

                        // Resized görüntüyü client'a geri gönder ve temp dosyasını sil
                        res.set('Content-Type', 'image/jpeg');
                        res.send(resizedImage);

                        // Geçici dosyayı sil
                        fs.unlinkSync(tempFilePath);
                    } catch (resizeError) {
                        console.error('Resize hatası:', resizeError);
                        res.status(500).send('Görüntü yeniden boyutlandırılamadı.');
                    }
                } else {
                    // Eğer boyutlandırma yoksa, orijinal thumbnail'i gönder
                    const thumbnailStream = fs.createReadStream(tempFilePath);
                    res.set('Content-Type', 'image/jpeg');
                    thumbnailStream.pipe(res);

                    // Thumbnail stream tamamlandığında geçici dosyayı sil
                    thumbnailStream.on('end', () => {
                        fs.unlinkSync(tempFilePath);
                    });
                }
            })
            .on('error', (err) => {
                console.error('ffmpeg hatası:', err);
                res.status(500).send('Thumbnail oluşturulamadı.');
            })
            .screenshots({
                count: 1,
                timemarks: ['0'], // Zaman damgası 0. saniyede (ilk kare)
                filename: uniqueFileName, // Benzersiz dosya adı
                folder: __dirname, // Dosyanın kaydedileceği klasör
            });
    } catch (error) {
        console.error('Video thumbnail alma hatası:', error);
        res.status(500).send('Video thumbnail alma hatası.');
    }
});
app.listen(port, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${port}`);
});
