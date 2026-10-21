package app.worldwide

import android.graphics.*
import android.media.ExifInterface
import java.io.*
import kotlin.math.max

/** Stream originals to disk; decode only a bounded display image into memory. */
object PhotoImporter {
    fun copy(input: InputStream, target: File, maxBytes: Long = 64L * 1024 * 1024) {
        target.outputStream().use { out ->
            val block = ByteArray(32768)
            var total = 0L
            while (true) {
                val count = input.read(block)
                if (count < 0) break
                total += count
                if (total > maxBytes)
                    throw IOException("Choose a photo smaller than ${maxBytes/1024/1024} MB.")
                out.write(block, 0, count)
            }
        }
    }

    private fun bounds(file: File) =
        BitmapFactory.Options().apply {
            inJustDecodeBounds = true
            BitmapFactory.decodeFile(file.path, this)
        }

    fun mime(file: File) = bounds(file).outMimeType ?: "application/octet-stream"

    fun extension(file: File) =
        when (mime(file)) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/heic",
            "image/heif" -> "heic"
            "image/avif" -> "avif"
            else -> "image"
        }

    fun import(repository: AlbumRepository, country: String, original: File) {
        val options = bounds(original)
        if (options.outWidth <= 0 || options.outHeight <= 0)
            throw IOException("This photo format is not supported on your phone.")
        options.inSampleSize = 1
        while (max(options.outWidth, options.outHeight) / options.inSampleSize > 3200) options
            .inSampleSize *= 2
        options.inJustDecodeBounds = false
        var bitmap =
            BitmapFactory.decodeFile(original.path, options)
                ?: throw IOException("Couldn't read this photo.")
        try {
            val transform = Matrix()
            try {
                when (
                    ExifInterface(original.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1)
                ) {
                    2 -> transform.setScale(-1f, 1f)
                    3 -> transform.setRotate(180f)
                    4 -> transform.setScale(1f, -1f)
                    5 -> {
                        transform.setRotate(90f)
                        transform.postScale(-1f, 1f)
                    }
                    6 -> transform.setRotate(90f)
                    7 -> {
                        transform.setRotate(270f)
                        transform.postScale(-1f, 1f)
                    }
                    8 -> transform.setRotate(270f)
                }
            } catch (_: IOException) {}
            if (!transform.isIdentity) {
                val upright =
                    Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, transform, true)
                if (upright !== bitmap) bitmap.recycle()
                bitmap = upright
            }
            val encoded = ByteArrayOutputStream()
            @Suppress("DEPRECATION")
            val written = bitmap.compress(Bitmap.CompressFormat.WEBP, 90, encoded)
            if (!written) throw IOException("Couldn't prepare this photo.")
            repository.importPhoto(
                country,
                "image/webp",
                encoded.toByteArray(),
                bitmap.width,
                bitmap.height,
                original,
            )
        } finally {
            bitmap.recycle()
        }
    }
}
