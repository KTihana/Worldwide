package app.worldwide

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.*
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import org.json.JSONObject

/** Installs code in place; the album directory is never part of the updater. */
class AndroidUpdater(context: Context, private val progress: Progress) {
    private val context = context.applicationContext

    fun interface Progress {
        fun update(percent: Int, status: String)
    }

    class Release(
        @JvmField val version: String,
        @JvmField val url: String,
        @JvmField val digest: String,
        @JvmField val size: Long,
    )

    private var checked: Release? = null

    @Synchronized
    fun check(): JSONObject {
        checked = null
        val connection = open(LATEST, false)
        val bytes =
            try {
                connection.inputStream.use { limited(it, 2 * 1024 * 1024) }
            } finally {
                connection.disconnect()
            }
        val release = parseRelease(JSONObject(String(bytes)))
        val installed = installed(context).versionName ?: "0.0.0"
        checked = release
        return JSONObject()
            .put("version", release.version)
            .put("installedVersion", installed)
            .put("available", newer(release.version, installed))
    }

    @Synchronized
    fun prepare(): File {
        if (checked == null) check()
        val release = checked!!
        if (!newer(release.version, installed(context).versionName ?: "0.0.0"))
            throw IOException("You already have the latest version.")
        val directory = File(context.cacheDir, "updates")
        if (!directory.isDirectory && !directory.mkdirs())
            throw IOException("Free some phone storage and try again.")
        val ready = File(directory, "Worldwide-${release.version}.apk")
        if (ready.isFile) {
            try {
                verifyDownload(ready, release)
                validateApk(context, ready, release.version)
                return ready
            } catch (_: Exception) {
                ready.delete()
            }
        }
        val partial = File(directory, "download.tmp")
        val connection = open(release.url, true)
        try {
            val length = connection.contentLengthLong
            if (length > 0 && length != release.size)
                throw IOException("The download size changed. Check for updates again.")
            connection.inputStream.use { input ->
                FileOutputStream(partial).use { out ->
                    val buffer = ByteArray(65536)
                    var count = 0L
                    var previous = -1
                    while (true) {
                        if (Thread.currentThread().isInterrupted)
                            throw IOException("Update interrupted.")
                        val n = input.read(buffer)
                        if (n < 0) break
                        count += n
                        if (count > release.size || count > MAX_APK)
                            throw IOException("The update was larger than expected.")
                        out.write(buffer, 0, n)
                        val percent = (count * 100 / release.size).toInt()
                        if (percent != previous) {
                            previous = percent
                            progress.update(percent, "Downloading update…")
                        }
                    }
                    out.fd.sync()
                }
            }
            progress.update(100, "Checking update…")
            verifyDownload(partial, release)
            validateApk(context, partial, release.version)
            Files.move(partial.toPath(), ready.toPath(), StandardCopyOption.REPLACE_EXISTING)
            directory
                .listFiles()
                ?.filter {
                    it != ready &&
                        it.name.matches(Regex("Worldwide-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))
                }
                ?.forEach { it.delete() }
            return ready
        } finally {
            connection.disconnect()
            partial.delete()
        }
    }

    companion object {
        private const val LATEST = "https://api.github.com/repos/KTihana/Worldwide/releases/latest"
        private const val MAX_APK = 200L * 1024 * 1024

        @JvmStatic
        fun parseRelease(json: JSONObject): Release {
            if (json.optBoolean("draft") || json.optBoolean("prerelease"))
                throw IOException("No stable update is available.")
            val tag = json.getString("tag_name")
            val version = tag.removePrefix("v")
            if (!version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+")))
                throw IOException("The update version could not be verified.")
            val assets = json.getJSONArray("assets")
            var result: Release? = null
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                if (asset.optString("name") != "Worldwide-Android.apk") continue
                if (result != null) throw IOException("Ambiguous Android downloads.")
                val url = asset.getString("browser_download_url")
                val uri = URI(url)
                if (
                    !trustedDownload(url) ||
                        uri.host != "github.com" ||
                        uri.rawPath !=
                            "/KTihana/Worldwide/releases/download/$tag/Worldwide-Android.apk" ||
                        uri.query != null
                )
                    throw IOException("The update is not from Worldwide's release page.")
                val size = asset.getLong("size")
                if (size <= 0 || size > MAX_APK) throw IOException("Invalid update size.")
                val digest = if (asset.isNull("digest")) "" else asset.optString("digest", "")
                if (digest.isNotEmpty() && !digest.matches(Regex("sha256:[a-fA-F0-9]{64}")))
                    throw IOException("Invalid update checksum.")
                result = Release(version, url, digest.lowercase(java.util.Locale.ROOT), size)
            }
            return result ?: throw IOException("This release has no Android update yet.")
        }

        @JvmStatic
        fun newer(candidate: String, installed: String): Boolean =
            try {
                val a = candidate.removePrefix("v").split('.').map { it.toLong() }
                val b = installed.removePrefix("v").split('.').map { it.toLong() }
                if (a.size != 3 || b.size != 3) false
                else
                    a.zip(b).firstOrNull { it.first != it.second }?.let { it.first > it.second }
                        ?: false
            } catch (_: Exception) {
                false
            }

        @JvmStatic
        fun trustedDownload(value: String): Boolean =
            try {
                val uri = URI(value)
                uri.scheme == "https" &&
                    uri.userInfo == null &&
                    uri.fragment == null &&
                    uri.port in listOf(-1, 443) &&
                    (uri.host == "github.com" &&
                        uri.path.startsWith("/KTihana/Worldwide/releases/download/") ||
                        uri.host in
                            setOf(
                                "release-assets.githubusercontent.com",
                                "objects.githubusercontent.com",
                                "github-releases.githubusercontent.com",
                            ))
            } catch (_: Exception) {
                false
            }

        private fun open(address: String, download: Boolean): HttpURLConnection {
            var next = address
            repeat(6) {
                if (if (download) !trustedDownload(next) else next != LATEST)
                    throw IOException("The update redirected outside the trusted release service.")
                val c = URL(next).openConnection() as HttpURLConnection
                c.instanceFollowRedirects = false
                c.connectTimeout = 15000
                c.readTimeout = 30000
                c.setRequestProperty("User-Agent", "Worldwide-Android-Updater")
                c.setRequestProperty(
                    "Accept",
                    if (download) "application/octet-stream" else "application/vnd.github+json",
                )
                val code = c.responseCode
                if (code == 200) return c
                if (download && code in listOf(301, 302, 303, 307, 308)) {
                    val location = c.getHeaderField("Location")
                    c.disconnect()
                    if (location == null) throw IOException("Missing update redirect")
                    next = URL(URL(next), location).toString()
                } else {
                    c.disconnect()
                    throw IOException(
                        if (code in listOf(403, 429))
                            "Update checks are temporarily limited. Try later."
                        else "Couldn't download the update. Check your connection."
                    )
                }
            }
            throw IOException("Too many update redirects.")
        }

        private fun limited(input: InputStream, limit: Int): ByteArray {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16384)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                if (out.size() + n > limit) throw IOException("Response too large")
                out.write(buffer, 0, n)
            }
            return out.toByteArray()
        }

        @JvmStatic
        fun verifyDownload(file: File, release: Release) {
            if (file.length() != release.size) throw IOException("The update is incomplete.")
            if (release.digest.isNotEmpty()) {
                val hash = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        hash.update(buffer, 0, n)
                    }
                }
                val actual = "sha256:" + hash.digest().joinToString("") { "%02x".format(it) }
                if (!MessageDigest.isEqual(actual.toByteArray(), release.digest.toByteArray()))
                    throw IOException("The update checksum did not match.")
            }
        }

        private fun signatureFlags() =
            if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
            else PackageManager.GET_SIGNATURES

        private fun installed(context: Context) =
            context.packageManager.getPackageInfo(context.packageName, signatureFlags())

        private fun signers(info: PackageInfo): Set<String> {
            val signatures =
                if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null)
                    info.signingInfo!!.apkContentsSigners
                else info.signatures
            return signatures?.map { it.toCharsString() }?.toSet() ?: emptySet()
        }

        @JvmStatic
        fun validateApk(context: Context, file: File, expectedVersion: String): PackageInfo {
            val current = installed(context)
            val candidate =
                context.packageManager.getPackageArchiveInfo(file.absolutePath, signatureFlags())
                    ?: throw IOException("Not an Android installer.")
            if (context.packageName != candidate.packageName)
                throw IOException("Not a Worldwide update.")
            val old =
                if (Build.VERSION.SDK_INT >= 28) current.longVersionCode
                else current.versionCode.toLong()
            val new =
                if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode
                else candidate.versionCode.toLong()
            if (
                new <= old ||
                    candidate.versionName != expectedVersion ||
                    !newer(candidate.versionName ?: "", current.versionName ?: "")
            )
                throw IOException("This update is not newer than the installed app.")
            val approved = signers(current)
            if (approved.isEmpty() || approved != signers(candidate))
                throw IOException(
                    "This update was signed with a different key. Your app and photos are unchanged."
                )
            return candidate
        }

        @JvmStatic
        fun install(activity: Activity, file: File): String {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                activity.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.packageName),
                    )
                )
                return "permission-required"
            }
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", file)
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
            return "installer-opened"
        }
    }
}
