package app.worldwide

import java.io.File
import java.io.IOException
import java.net.*
import java.util.concurrent.TimeUnit
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Explicit public image imports use no album session and cannot reach private networks. */
object PublicPhotoDownload {
    internal fun publicAddress(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
                address.isLoopbackAddress ||
                address.isLinkLocalAddress ||
                address.isSiteLocalAddress ||
                address.isMulticastAddress
        )
            return false
        val b = address.address.map { it.toInt() and 255 }
        return if (b.size == 4) {
            val a = b[0]
            val c = b[1]
            a !in listOf(0, 10, 127) &&
                a < 224 &&
                !(a == 100 && c in 64..127) &&
                !(a == 169 && c == 254) &&
                !(a == 172 && c in 16..31) &&
                !(a == 192 && (c == 168 || c == 0 || c == 2)) &&
                !(a == 198 && (c == 18 || c == 19 || c == 51 && b[2] == 100)) &&
                !(a == 203 && c == 0 && b[2] == 113)
        } else
            b.size == 16 &&
                b[0] in 0x20..0x3f &&
                !(b[0] == 0x20 && b[1] == 1 && (b[2] < 2 || b[2] == 0x0d && b[3] == 0xb8))
    }

    private val client =
        OkHttpClient.Builder()
            .proxy(Proxy.NO_PROXY)
            .dns(
                object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> {
                        val addresses = InetAddress.getAllByName(hostname).toList()
                        if (addresses.isEmpty() || addresses.any { !publicAddress(it) })
                            throw UnknownHostException("Use a public image address.")
                        return addresses
                    }
                }
            )
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(25, TimeUnit.SECONDS)
            .build()

    fun download(value: String, target: File) {
        var url = value.toHttpUrlOrNull() ?: throw IOException("Copy a direct image address.")
        repeat(6) { hop ->
            if (url.username.isNotEmpty() || url.password.isNotEmpty())
                throw IOException("Use a public image address without a password.")
            client
                .newCall(Request.Builder().url(url).header("Accept", "image/*").build())
                .execute()
                .use { response ->
                    if (response.code in listOf(301, 302, 303, 307, 308)) {
                        if (hop == 5) throw IOException("This image redirects too many times.")
                        url =
                            url.resolve(response.header("Location") ?: "")
                                ?: throw IOException("Invalid image redirect.")
                    } else {
                        if (!response.isSuccessful)
                            throw IOException("Couldn't download this image (${response.code}).")
                        val body = response.body ?: throw IOException("This address has no image.")
                        if (body.contentLength() > 32L * 1024 * 1024)
                            throw IOException("Choose an image smaller than 32 MB.")
                        body.byteStream().use { PhotoImporter.copy(it, target, 32L * 1024 * 1024) }
                        return
                    }
                }
        }
    }
}
