package app.worldwide

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Instant
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/** Same private database, journal and identity pins as the installed app. No UI or WebView. */
class AlbumRepository(private val context: Context) : AutoCloseable {
    val prefs = context.getSharedPreferences("worldwide", Context.MODE_PRIVATE)
    val directory = File(context.filesDir, "album").apply { mkdirs() }
    internal val local: LocalAlbum
    private val syncWorker = Executors.newSingleThreadScheduledExecutor()
    private val busy = AtomicBoolean()
    private val released = AtomicBoolean()
    @Volatile private var generation = 0
    @Volatile private var closed = false
    @Volatile
    var photoRevision = 0
        private set

    @Volatile
    var connected = false
        private set

    @Volatile
    var syncError = ""
        private set

    private var lastAttempt = 0L
    @Volatile var onChanged: (() -> Unit)? = null

    init {
        val account = JSONObject(prefs.getString("account", "{}")!!).optJSONObject("account")
        if (
            prefs.getString("album-owner", "").isNullOrEmpty() &&
                !account?.optString("email").isNullOrEmpty()
        )
            prefs
                .edit()
                .putString("album-owner", account!!.getString("email").lowercase(Locale.ROOT))
                .commit()
        val ids =
            jsonArray(
                    context.assets.open("map/countries.json").bufferedReader().use { it.readText() }
                )
                .map { it.getString("id") }
                .toSet()
        local = LocalAlbum.open(directory, !prefs.getString("album-owner", "").isNullOrEmpty(), ids)
        syncWorker.scheduleWithFixedDelay({ requestSync(false) }, 5, 15, TimeUnit.SECONDS)
    }

    fun atlas(): JSONObject = local.atlas()

    fun account(): JSONObject? =
        if (prefs.getString("cookie", "").isNullOrEmpty()) null
        else JSONObject(prefs.getString("account", "{}")!!).optJSONObject("account")

    fun status() =
        JSONObject()
            .put("paired", account() != null)
            .put("connected", connected)
            .put("pending", local.pending())
            .put("error", syncError)
            .put("lastSynced", prefs.getString("last-synced", ""))

    fun patch(path: String, body: JSONObject) {
        request(path, "PATCH", body)
    }

    fun request(path: String, method: String = "GET", body: JSONObject = JSONObject()): JSONObject {
        val response =
            local.request(
                path,
                method,
                JSONObject().put("content-type", "application/json"),
                if (method == "GET") byteArrayOf() else body.toString().toByteArray(),
            ) ?: throw IOException("This action is unavailable on this phone.")
        if (response.status !in 200..299)
            throw IOException(
                JSONObject(String(response.bytes)).optString("error", "Please try again.")
            )
        if (method != "GET") changed()
        return JSONObject(String(response.bytes))
    }

    fun photoFile(id: String): File = File(directory, LocalAlbum.key("/api/photos/$id") + ".photo")

    fun originalFile(id: String): File =
        File(directory, LocalAlbum.key("/api/photos/$id") + ".original").takeIf { it.isFile }
            ?: photoFile(id)

    fun importPhoto(
        country: String,
        mime: String,
        bytes: ByteArray,
        width: Int,
        height: Int,
        original: File,
    ): JSONObject {
        val id = java.util.UUID.randomUUID().toString()
        val boundary = "WorldwideNative" + System.nanoTime()
        val out = java.io.ByteArrayOutputStream()
        for ((key, value) in
            mapOf(
                "photoId" to id,
                "countryId" to country,
                "width" to "$width",
                "height" to "$height",
            )) out.write(
            "--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n$value\r\n"
                .toByteArray()
        )
        out.write(
            "--$boundary\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"memory\"\r\nContent-Type: $mime\r\n\r\n"
                .toByteArray()
        )
        out.write(bytes)
        out.write("\r\n--$boundary--\r\n".toByteArray())
        val response =
            local.importPhoto(
                id,
                original,
                JSONObject().put("content-type", "multipart/form-data; boundary=$boundary"),
                out.toByteArray(),
            )!!
        val photo = JSONObject(String(response.bytes))
        if (response.status != 201)
            throw IOException(photo.optString("error", "Couldn't save the photo."))
        changed()
        return photo
    }

    private fun changed() {
        onChanged?.invoke()
        requestSync(true)
        MapWidgetProvider.requestRefresh(context)
    }

    @Synchronized
    fun disconnect() {
        generation++
        connected = false
        syncError = ""
        prefs
            .edit()
            .remove("cookie")
            .remove("account")
            .remove("candidate-server")
            .remove("offline-state")
            .commit()
        onChanged?.invoke()
    }

    private fun verifyIdentity(origin: String, account: JSONObject): String {
        val id = account.optString("albumId")
        val pinned = prefs.getString("album-owner-id", "")!!
        val email = prefs.getString("album-owner", "")!!
        if (!id.matches(Regex("[a-f0-9]{32}")))
            throw IOException(
                "Update Worldwide on your computer before syncing. Your phone album is saved."
            )
        if (pinned.isNotEmpty() && pinned != id)
            throw IOException(
                "This is a different computer album. Your phone album has not been merged."
            )
        if (email.isNotEmpty() && !email.equals(account.optString("email").trim(), true))
            throw IOException(
                "Connect the original account ($email). Your phone album is unchanged."
            )
        if (pinned.isEmpty() && email.isNotEmpty() && origin != prefs.getString("server", ""))
            throw IOException("Connect to your original computer once before changing its address.")
        return id
    }

    @Synchronized
    private fun link(origin: String, cookie: String?, account: JSONObject, expected: Int) {
        if (generation != expected || closed)
            throw IOException("Your connection changed. Please try again.")
        val email = account.optString("email").trim().lowercase(Locale.ROOT)
        if (cookie.isNullOrEmpty() || email.isEmpty() || email.length > 254)
            throw IOException("The computer returned an incomplete session.")
        val id = verifyIdentity(origin, account)
        if (
            !prefs
                .edit()
                .putString("server", origin)
                .putString("cookie", cookie)
                .putString("album-owner", email)
                .putString("album-owner-id", id)
                .putString(
                    "account",
                    JSONObject().put("account", account).put("needsSetup", false).toString(),
                )
                .remove("candidate-server")
                .commit()
        )
            throw IOException("Couldn't save the connection.")
        generation++
        connected = false
        syncError = ""
        lastAttempt = 0
    }

    fun pair(value: String) {
        val expected = generation
        val (origin, token) = parsePairing(value)
        val result =
            network(
                origin,
                "/api/auth/pair-complete",
                "POST",
                JSONObject().put("content-type", "application/json"),
                JSONObject().put("token", token).toString().toByteArray(),
                "",
            )
        successful(result)
        link(origin, result.cookie, result.json().getJSONObject("account"), expected)
        requestSync(true)
        onChanged?.invoke()
    }

    fun login(address: String, identifier: String, password: String) {
        val expected = generation
        val origin = normalize(address)
        val health = network(origin, "/api/health", "GET", JSONObject(), byteArrayOf(), "")
        successful(health)
        if (health.json().optString("app") !in listOf("worldwide-local", "elsewhere-local"))
            throw IOException("This is not a Worldwide computer.")
        val result =
            network(
                origin,
                "/api/auth/login",
                "POST",
                JSONObject().put("content-type", "application/json"),
                JSONObject()
                    .put("identifier", identifier)
                    .put("password", password)
                    .toString()
                    .toByteArray(),
                "",
            )
        successful(result)
        link(origin, result.cookie, result.json().getJSONObject("account"), expected)
        requestSync(true)
        onChanged?.invoke()
    }

    fun changeUsername(value: String) {
        val expected = generation
        val origin = prefs.getString("server", "")!!
        val cookie = prefs.getString("cookie", "")!!
        val result =
            network(
                origin,
                "/api/auth/username",
                "PATCH",
                JSONObject().put("content-type", "application/json"),
                JSONObject().put("username", value).toString().toByteArray(),
                cookie,
            )
        successful(result)
        link(origin, cookie, result.json().getJSONObject("account"), expected)
        onChanged?.invoke()
    }

    fun requestSync(immediate: Boolean = true) {
        synchronized(this) {
            if (
                closed ||
                    prefs.getString("cookie", "").isNullOrEmpty() ||
                    (!immediate && System.currentTimeMillis() - lastAttempt < 30000) ||
                    !busy.compareAndSet(false, true)
            )
                return
            lastAttempt = System.currentTimeMillis()
        }
        try {
            syncWorker.execute {
                try {
                    sync()
                } finally {
                    busy.set(false)
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            busy.set(false)
        }
    }

    private fun same(expected: Int, origin: String, cookie: String) =
        !closed &&
            expected == generation &&
            origin == prefs.getString("server", "") &&
            cookie == prefs.getString("cookie", "")

    private fun sync() {
        val expected = generation
        val origin = prefs.getString("server", "")!!
        val cookie = prefs.getString("cookie", "")!!
        if (origin.isEmpty() || cookie.isEmpty()) return
        try {
            val session =
                network(origin, "/api/auth/session", "GET", JSONObject(), byteArrayOf(), cookie)
            successful(session)
            val identity =
                session.json().optJSONObject("account")
                    ?: throw IOException("Reconnect to your computer. Your phone album is saved.")
            synchronized(this) {
                if (!same(expected, origin, cookie)) return
                val id = verifyIdentity(origin, identity)
                if (
                    !prefs
                        .edit()
                        .putString("album-owner-id", id)
                        .putString(
                            "album-owner",
                            identity.getString("email").lowercase(Locale.ROOT),
                        )
                        .putString("account", JSONObject().put("account", identity).toString())
                        .commit()
                )
                    throw IOException("Couldn't save the computer identity.")
            }
            for (index in 0 until 1000) {
                if (!same(expected, origin, cookie)) return
                val mutation = local.next() ?: break
                if (
                    mutation.path == "/api/photos" &&
                        mutation.method == "POST" &&
                        !local.containsPhoto(mutation.body.getString("id"))
                ) {
                    val result =
                        network(
                            origin,
                            "/api/countries/" + mutation.body.getString("countryId"),
                            "PATCH",
                            JSONObject().put("content-type", "application/json"),
                            JSONObject().put("visited", true).toString().toByteArray(),
                            cookie,
                        )
                    successful(result)
                    synchronized(this) {
                        if (!same(expected, origin, cookie)) return
                        local.acknowledge(mutation.id)
                    }
                    continue
                }
                val headers = JSONObject().put("content-type", "application/json")
                var bytes = mutation.body.toString().toByteArray()
                if (mutation.path == "/api/photos" && mutation.method == "POST") {
                    val upload = local.upload(mutation)
                    headers.put("content-type", upload.contentType)
                    bytes = upload.bytes
                }
                var response =
                    network(origin, mutation.path, mutation.method, headers, bytes, cookie)
                val gone =
                    response.status == 404 &&
                        mutation.path.matches(Regex("/api/photos/[a-zA-Z0-9_-]+")) &&
                        !mutation.path.endsWith("/order")
                if (response.status == 409 && mutation.path == "/api/photos/order") {
                    val remote =
                        network(origin, "/api/atlas", "GET", JSONObject(), byteArrayOf(), cookie)
                    successful(remote)
                    val available =
                        jsonObjects(remote.json().getJSONArray("photos"))
                            .filter {
                                it.getString("countryId") == mutation.body.getString("countryId")
                            }
                            .map { it.getString("id") }
                            .toMutableSet()
                    val ids = JSONArray()
                    val desired = mutation.body.getJSONArray("ids")
                    for (i in 0 until desired.length()) if (available.remove(desired.getString(i)))
                        ids.put(desired.getString(i))
                    available.forEach { ids.put(it) }
                    response =
                        network(
                            origin,
                            mutation.path,
                            mutation.method,
                            headers,
                            JSONObject()
                                .put("countryId", mutation.body.getString("countryId"))
                                .put("ids", ids)
                                .toString()
                                .toByteArray(),
                            cookie,
                        )
                }
                if (
                    response.status == 400 &&
                        mutation.path.startsWith("/api/countries/") &&
                        mutation.body.has("coverId") &&
                        !mutation.body.isNull("coverId")
                ) {
                    val photo =
                        network(
                            origin,
                            "/api/photos/" + mutation.body.getString("coverId"),
                            "GET",
                            JSONObject(),
                            byteArrayOf(),
                            cookie,
                        )
                    if (photo.status == 404)
                        response =
                            network(
                                origin,
                                mutation.path,
                                mutation.method,
                                headers,
                                JSONObject(mutation.body.toString())
                                    .put("coverId", JSONObject.NULL)
                                    .toString()
                                    .toByteArray(),
                                cookie,
                            )
                }
                if (!gone) successful(response)
                synchronized(this) {
                    if (!same(expected, origin, cookie)) return
                    local.acknowledge(mutation.id)
                }
            }
            if (local.pending() > 0) return
            val revision = local.revision()
            val result = network(origin, "/api/atlas", "GET", JSONObject(), byteArrayOf(), cookie)
            successful(result)
            val remote = result.json()
            for (photo in jsonObjects(remote.getJSONArray("photos"))) {
                if (!same(expected, origin, cookie)) return
                val id = photo.getString("id")
                if (!local.hasPhoto(id)) {
                    val reply =
                        network(
                            origin,
                            "/api/photos/$id",
                            "GET",
                            JSONObject(),
                            byteArrayOf(),
                            cookie,
                        )
                    successful(reply)
                    synchronized(this) {
                        if (!same(expected, origin, cookie)) return
                        local.savePhoto(id, reply.mime, reply.bytes)
                        photoRevision++
                    }
                }
            }
            synchronized(this) {
                if (!same(expected, origin, cookie) || !local.acceptRemote(remote, revision)) return
                local.prune()
                connected = true
                syncError = ""
                prefs.edit().putString("last-synced", Instant.now().toString()).commit()
            }
            if (local.revision() != revision || photoRevision > 0)
                MapWidgetProvider.requestRefresh(context)
        } catch (error: Exception) {
            synchronized(this) {
                if (same(expected, origin, cookie)) {
                    connected = false
                    syncError =
                        error.message ?: "Sync is waiting. Your photos are saved on this phone."
                }
            }
        } finally {
            if (!closed) onChanged?.invoke()
        }
    }

    override fun close() {
        if (!released.compareAndSet(false, true)) return
        closed = true
        generation++
        onChanged = null
        syncWorker.shutdownNow()
        syncWorker.awaitTermination(18, TimeUnit.SECONDS)
        local.close()
    }

    data class Reply(
        val status: Int,
        val mime: String,
        val bytes: ByteArray,
        val cookie: String? = null,
    ) {
        fun json() = JSONObject(String(bytes, Charsets.UTF_8))
    }

    companion object {
        fun jsonObjects(array: JSONArray) = (0 until array.length()).map { array.getJSONObject(it) }

        fun jsonArray(text: String) = jsonObjects(JSONArray(text))

        fun normalize(address: String): String {
            val uri = URI(address.trim())
            val host = uri.host ?: throw IOException("Enter the computer's address.")
            if (
                uri.userInfo != null ||
                    uri.query != null ||
                    uri.fragment != null ||
                    uri.path !in listOf("", "/") ||
                    uri.port == 0 ||
                    uri.port < -1 ||
                    uri.port > 65535
            )
                throw IOException("Use only the computer address, such as http://192.168.1.20:3000")
            if (uri.scheme != "https" && !(uri.scheme == "http" && privateHost(host)))
                throw IOException("Local computers use HTTP; remote connections require HTTPS.")
            return "${uri.scheme}://$host" + if (uri.port > 0) ":${uri.port}" else ""
        }

        private fun privateHost(host: String): Boolean {
            if (host == "localhost") return true
            val p = host.split('.')
            if (p.size != 4 || p.any { !it.matches(Regex("[0-9]{1,3}")) || it.toInt() > 255 })
                return false
            val n = p.map { it.toInt() }
            return n[0] == 10 ||
                n[0] == 127 ||
                n[0] == 192 && n[1] == 168 ||
                n[0] == 172 && n[1] in 16..31 ||
                n[0] == 169 && n[1] == 254
        }

        fun parsePairing(value: String): Pair<String, String> {
            if (value.length > 4096) throw IOException("Scan the QR shown on your computer.")
            val uri = Uri.parse(value)
            if (uri.scheme in listOf("http", "https")) {
                val fragment = uri.encodedFragment ?: ""
                if (!fragment.matches(Regex("worldwide-pair=[a-f0-9]{64}")))
                    throw IOException("This is not a Worldwide pairing code.")
                return normalize(uri.buildUpon().fragment(null).build().toString()) to
                    fragment.substringAfter('=')
            }
            if (
                uri.scheme != "worldwide" ||
                    uri.authority != "pair" ||
                    uri.fragment != null ||
                    !uri.path.isNullOrEmpty() ||
                    uri.queryParameterNames != setOf("server", "token") ||
                    uri.getQueryParameters("server").size != 1 ||
                    uri.getQueryParameters("token").size != 1
            )
                throw IOException("This is not a Worldwide pairing code.")
            val token = uri.getQueryParameter("token") ?: ""
            if (!token.matches(Regex("[a-f0-9]{64}")))
                throw IOException("This pairing code is incomplete.")
            return normalize(uri.getQueryParameter("server")!!) to token
        }

        private fun successful(reply: Reply) {
            if (reply.status !in 200..299)
                throw IOException(
                    runCatching { reply.json().optString("error") }
                        .getOrNull()
                        .takeUnless { it.isNullOrEmpty() }
                        ?: "Couldn't sync. Your photos are saved on this phone."
                )
        }

        private fun network(
            origin: String,
            path: String,
            method: String,
            headers: JSONObject,
            body: ByteArray,
            cookie: String,
        ): Reply {
            if (!path.matches(Regex("/api/[a-zA-Z0-9_/-]+")) || path.contains(".."))
                throw IOException("Invalid API path")
            val connection = URL(origin + path).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 2500
                connection.readTimeout = 15000
                connection.instanceFollowRedirects = false
                connection.requestMethod = method
                connection.setRequestProperty("Origin", origin)
                connection.setRequestProperty("Accept", "application/json")
                if (cookie.isNotEmpty()) connection.setRequestProperty("Cookie", cookie)
                if (headers.has("content-type"))
                    connection.setRequestProperty("Content-Type", headers.getString("content-type"))
                if (method !in listOf("GET", "HEAD")) {
                    connection.doOutput = true
                    connection.setFixedLengthStreamingMode(body.size)
                    connection.outputStream.use { it.write(body) }
                }
                val status = connection.responseCode
                if (status in 300..399)
                    throw IOException("The computer redirected. Use its direct address.")
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val bytes =
                    stream?.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(32768)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            if (out.size() + n > 40 * 1024 * 1024)
                                throw IOException("This response is too large")
                            out.write(buffer, 0, n)
                        }
                        out.toByteArray()
                    } ?: byteArrayOf()
                var session: String? = null
                connection.headerFields.forEach { (key, values) ->
                    if (key.equals("set-cookie", true))
                        values.forEach {
                            val entry = it.substringBefore(';')
                            if (
                                entry.matches(Regex("(?:elsewhere|worldwide)_session=[a-f0-9]{64}"))
                            )
                                session = entry
                        }
                }
                return Reply(
                    status,
                    (connection.contentType ?: "application/octet-stream").substringBefore(';'),
                    bytes,
                    session,
                )
            } finally {
                connection.disconnect()
            }
        }
    }
}
