package app.worldwide

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.system.Os
import android.system.OsConstants
import java.io.*
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** Existing schema, filenames and transaction boundaries are deliberately preserved. */
class LocalAlbum(
    private val directory: File,
    migratedFromLinkedAccount: Boolean,
    countryIds: Set<String>,
) {
    class Reply(
        @JvmField val status: Int,
        @JvmField val mime: String,
        @JvmField val bytes: ByteArray,
    )

    class ApiException(@JvmField val status: Int, message: String) : IOException(message)

    class Mutation(
        @JvmField val id: Long,
        @JvmField val path: String,
        @JvmField val method: String,
        @JvmField val body: JSONObject,
    )

    class Upload(@JvmField val contentType: String, @JvmField val bytes: ByteArray)

    private val countryIds = countryIds.toSet()
    private val db: SQLiteDatabase

    init {
        directory.mkdirs()
        db = SQLiteDatabase.openOrCreateDatabase(File(directory, "local.sqlite"), null)
        db.execSQL("PRAGMA synchronous=FULL")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS album (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, revision INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS mutations (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, method TEXT NOT NULL, body TEXT NOT NULL)"
        )
        db.rawQuery("SELECT id FROM album WHERE id=1", null).use { row ->
            if (!row.moveToFirst()) {
                val legacy = File(directory, "atlas.json")
                val atlas =
                    if (legacy.isFile) JSONObject(legacy.readText())
                    else
                        JSONObject()
                            .put("photos", JSONArray())
                            .put("visits", JSONArray())
                            .put("mapStyle", "natural-earth")
                atlas.getJSONArray("photos")
                atlas.getJSONArray("visits")
                transaction {
                    db.insertOrThrow(
                        "album",
                        null,
                        ContentValues().apply {
                            put("id", 1)
                            put("json", atlas.toString())
                            put("revision", 0)
                        },
                    )
                    if (!migratedFromLinkedAccount) {
                        for (photo in objects(atlas.getJSONArray("photos"))) {
                            enqueue("/api/photos", "POST", photo)
                            enqueue(
                                "/api/photos/" + photo.getString("id"),
                                "PATCH",
                                JSONObject()
                                    .put("cropX", photo.optDouble("cropX", 0.0))
                                    .put("cropY", photo.optDouble("cropY", 0.0))
                                    .put("cropZoom", photo.optDouble("cropZoom", 1.0)),
                            )
                        }
                        for (visit in objects(atlas.getJSONArray("visits"))) enqueue(
                            "/api/countries/" + visit.getString("countryId"),
                            "PATCH",
                            visitPatch(visit),
                        )
                    }
                }
            }
        }
        mirror()
    }

    private fun transaction(action: () -> Unit) {
        db.beginTransaction()
        try {
            action()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun atlas(): JSONObject =
        db.rawQuery("SELECT json FROM album WHERE id=1", null).use {
            check(it.moveToFirst())
            JSONObject(it.getString(0))
        }

    @Synchronized
    fun revision(): Long =
        db.rawQuery("SELECT revision FROM album WHERE id=1", null).use {
            it.moveToFirst()
            it.getLong(0)
        }

    @Synchronized
    fun pending(): Int =
        db.rawQuery("SELECT COUNT(*) FROM mutations", null).use {
            it.moveToFirst()
            it.getInt(0)
        }

    @Synchronized
    fun next(): Mutation? =
        db.rawQuery("SELECT id,path,method,body FROM mutations ORDER BY id LIMIT 1", null).use {
            if (it.moveToFirst())
                Mutation(
                    it.getLong(0),
                    it.getString(1),
                    it.getString(2),
                    JSONObject(it.getString(3)),
                )
            else null
        }

    @Synchronized
    fun acknowledge(id: Long) {
        db.delete("mutations", "id=?", arrayOf(id.toString()))
    }

    private fun enqueue(path: String, method: String, body: JSONObject) {
        db.insertOrThrow(
            "mutations",
            null,
            ContentValues().apply {
                put("path", path)
                put("method", method)
                put("body", body.toString())
            },
        )
    }

    private fun write(atlas: JSONObject) {
        db.update("album", ContentValues().apply { put("json", atlas.toString()) }, "id=1", null)
        db.execSQL("UPDATE album SET revision=revision+1 WHERE id=1")
    }

    private fun mirror() {
        atomic(File(directory, "atlas.json"), atlas().toString().toByteArray())
    }

    private fun mirrorBestEffort() {
        runCatching { mirror() }
    }

    @Synchronized
    fun photo(id: String): Reply? {
        val key = key("/api/photos/$id")
        val bytes = File(directory, "$key.photo")
        val mime = File(directory, "$key.mime")
        if (!bytes.isFile || !mime.isFile) return null
        val type = mime.readText()
        return if (type.startsWith("image/")) Reply(200, type, bytes.readBytes()) else null
    }

    @Synchronized
    fun hasPhoto(id: String) =
        File(directory, key("/api/photos/$id") + ".photo").isFile &&
            File(directory, key("/api/photos/$id") + ".mime").isFile

    @Synchronized
    fun savePhoto(id: String, mime: String, bytes: ByteArray) {
        if (!id.matches(Regex("[a-zA-Z0-9_-]+")) || !mime.startsWith("image/"))
            throw IOException("Invalid photo response.")
        val key = key("/api/photos/$id")
        atomic(File(directory, "$key.photo"), bytes)
        atomic(File(directory, "$key.mime"), mime.toByteArray())
    }

    @Synchronized
    fun saveOriginal(id: String, bytes: ByteArray) {
        requireValue(id.matches(Regex("[a-zA-Z0-9_-]+")), "Invalid photo ID.")
        atomic(File(directory, key("/api/photos/$id") + ".original"), bytes)
    }

    @Synchronized
    fun saveOriginal(id: String, source: File) {
        requireValue(id.matches(Regex("[a-zA-Z0-9_-]+")), "Invalid photo ID.")
        val target = File(directory, key("/api/photos/$id") + ".original")
        atomicWrite(target) { out -> source.inputStream().use { it.copyTo(out) } }
    }

    @Synchronized
    fun importPhoto(id: String, original: File, headers: JSONObject, bytes: ByteArray): Reply {
        saveOriginal(id, original)
        return request("/api/photos", "POST", headers, bytes)!!
    }

    private fun country(value: String): String {
        requireValue(countryIds.contains(value), "Choose a country.")
        return value
    }

    private fun visit(visits: JSONArray, id: String): JSONObject =
        objects(visits).find { it.optString("countryId") == id }
            ?: JSONObject()
                .put("countryId", id)
                .put("visited", 0)
                .put("coverId", JSONObject.NULL)
                .put("note", "")
                .put("visitDate", JSONObject.NULL)
                .put("updatedAt", Instant.now().toString())
                .also { visits.put(it) }

    @Synchronized
    fun request(path: String, method: String, headers: JSONObject?, bytes: ByteArray): Reply? {
        if (path == "/api/atlas" && method == "GET") return json(200, atlas())
        if (path.matches(Regex("/api/photos/[a-zA-Z0-9_-]+")) && method == "GET") {
            val id = path.substringAfterLast('/')
            if (!containsPhoto(id)) throw ApiException(404, "Photo not found.")
            return photo(id)
                ?: throw ApiException(
                    404,
                    "This photo has not downloaded yet. Connect once to save it on this device.",
                )
        }
        val upload = path == "/api/photos" && method == "POST"
        val order = path == "/api/photos/order" && method == "PATCH"
        val photo =
            path.matches(Regex("/api/photos/[a-zA-Z0-9_-]+")) &&
                method in listOf("PATCH", "DELETE") &&
                !order
        val country = path.matches(Regex("/api/countries/[A-Z]{3}")) && method == "PATCH"
        val preference = path == "/api/preferences" && method == "PATCH"
        if (!upload && !order && !photo && !country && !preference) return null
        var body = if (upload || bytes.isEmpty()) JSONObject() else JSONObject(String(bytes))
        val atlas = atlas()
        val photos = atlas.getJSONArray("photos")
        val visits = atlas.getJSONArray("visits")
        var response = JSONObject().put("ok", true)
        var status = 200
        if (upload) {
            val parts = multipart(headers?.optString("content-type") ?: "", bytes)
            val file = parts["photo"] ?: throw ApiException(400, "Choose a photo.")
            val country = country(field(parts, "countryId"))
            requireValue(
                file.bytes.isNotEmpty() && file.bytes.size <= 8 * 1024 * 1024,
                "Choose a photo smaller than 8 MB.",
            )
            requireValue(
                validImage(file.mime, file.bytes),
                "Use a valid JPG, PNG, WebP, GIF or AVIF photo.",
            )
            val id = field(parts, "photoId").ifEmpty { UUID.randomUUID().toString() }
            requireValue(
                id.matches(Regex("[a-zA-Z0-9_-]{1,100}")) && !containsPhoto(id),
                "Invalid or duplicate photo ID.",
            )
            val width = dimension(field(parts, "width"))
            val height = dimension(field(parts, "height"))
            requireValue((width == 0) == (height == 0), "Invalid photo dimensions.")
            body =
                JSONObject()
                    .put("id", id)
                    .put("photoId", id)
                    .put("countryId", country)
                    .put("caption", field(parts, "caption").take(500))
                    .put("width", width)
                    .put("height", height)
                    .put("createdAt", Instant.now().toString())
                    .put("cropX", 0)
                    .put("cropY", 0)
                    .put("cropZoom", 1)
            savePhoto(id, file.mime, file.bytes)
            val ordered = JSONArray().put(body)
            objects(photos).forEach { ordered.put(it) }
            atlas.put("photos", ordered)
            val visit = visit(visits, country)
            visit.put("visited", 1).put("updatedAt", Instant.now().toString())
            if (visit.isNull("coverId")) visit.put("coverId", id)
            response = body
            status = 201
        } else if (order) {
            val country = country(body.optString("countryId"))
            val ids = body.optJSONArray("ids") ?: throw ApiException(400, "Invalid photo order.")
            val expected =
                objects(photos)
                    .filter { it.getString("countryId") == country }
                    .map { it.getString("id") }
                    .toSet()
            val supplied = (0 until ids.length()).map { ids.getString(it) }
            requireValue(
                supplied.size == supplied.toSet().size && expected == supplied.toSet(),
                "Photos changed. Please try again.",
            )
            val byId = objects(photos).associateBy { it.getString("id") }
            val ordered = JSONArray()
            supplied.forEach { ordered.put(byId[it]) }
            objects(photos)
                .filter { it.getString("countryId") != country }
                .forEach { ordered.put(it) }
            atlas.put("photos", ordered)
        } else if (photo) {
            val id = path.substringAfterLast('/')
            val index = find(photos, "id", id)
            if (index < 0) throw ApiException(404, "Photo not found.")
            val value = photos.getJSONObject(index)
            if (method == "DELETE") {
                photos.remove(index)
                for (visit in objects(visits)) if (visit.optString("coverId") == id) {
                    visit.put(
                        "coverId",
                        objects(photos)
                            .find { it.getString("countryId") == value.getString("countryId") }
                            ?.getString("id") ?: JSONObject.NULL,
                    )
                }
            } else {
                var changed = false
                for (name in listOf("caption", "cropX", "cropY", "cropZoom")) if (body.has(name)) {
                    val raw = body.get(name)
                    if (name == "caption")
                        requireValue(
                            raw is String && raw.length <= 500,
                            "Keep captions under 500 characters.",
                        )
                    else
                        requireValue(
                            raw is Number &&
                                raw.toDouble().isFinite() &&
                                raw.toDouble() >= if (name == "cropZoom") 1.0 else -1.0,
                            "Invalid photo position.",
                        )
                    if (raw is Number)
                        requireValue(
                            raw.toDouble() <= if (name == "cropZoom") 5.0 else 1.0,
                            "Invalid photo position.",
                        )
                    value.put(name, raw)
                    changed = true
                }
                requireValue(changed, "No photo changes supplied.")
            }
        } else if (country) {
            val id = country(path.substringAfterLast('/'))
            val visit = visit(visits, id)
            if (body.has("visited")) {
                requireValue(body.get("visited") is Boolean, "Invalid visit status.")
                visit.put("visited", if (body.getBoolean("visited")) 1 else 0)
            }
            if (body.has("note")) {
                requireValue(
                    body.get("note") is String && body.getString("note").length <= 4000,
                    "Keep notes under 4,000 characters.",
                )
                visit.put("note", body.get("note"))
            }
            if (body.has("visitDate")) {
                if (!body.isNull("visitDate")) {
                    val value = body.get("visitDate")
                    requireValue(
                        value is String && value.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
                        "Choose a valid date.",
                    )
                    try {
                        LocalDate.parse(value as String)
                    } catch (e: Exception) {
                        throw ApiException(400, "Choose a valid date.")
                    }
                }
                visit.put("visitDate", body.get("visitDate"))
            }
            if (body.has("coverId")) {
                if (!body.isNull("coverId")) {
                    val index = find(photos, "id", body.getString("coverId"))
                    requireValue(
                        index >= 0 && photos.getJSONObject(index).getString("countryId") == id,
                        "Choose a photo from this country.",
                    )
                }
                visit.put("coverId", body.get("coverId"))
            }
            visit.put("updatedAt", Instant.now().toString())
        } else {
            val style = body.optString("mapStyle")
            requireValue(
                style in
                    listOf(
                        "equal-earth",
                        "natural-earth",
                        "robinson",
                        "winkel-tripel",
                        "mercator",
                        "equirectangular",
                        "mollweide",
                        "gall-peters",
                        "sinusoidal",
                        "eckert-iv",
                        "goode",
                    ),
                "Choose a valid map style.",
            )
            atlas.put("mapStyle", style)
        }
        transaction {
            write(atlas)
            enqueue(path, method, body)
        }
        mirrorBestEffort()
        if (method == "DELETE") runCatching { prune() }
        return json(status, response)
    }

    @Synchronized
    fun containsPhoto(id: String) = find(atlas().getJSONArray("photos"), "id", id) >= 0

    @Synchronized
    fun prune() {
        val keep =
            objects(atlas().getJSONArray("photos"))
                .map { key("/api/photos/" + it.getString("id")) }
                .toMutableSet()
        db.rawQuery("SELECT body FROM mutations WHERE path='/api/photos' AND method='POST'", null)
            .use {
                while (it.moveToNext()) keep.add(
                    key("/api/photos/" + JSONObject(it.getString(0)).getString("id"))
                )
            }
        directory.listFiles()?.forEach {
            if (
                it.name.matches(Regex("[a-f0-9]{64}\\.(photo|mime|original)")) &&
                    it.name.substring(0, 64) !in keep
            )
                it.delete()
        }
    }

    @Synchronized
    fun close() {
        synchronized(stores) {
            val key = directory.canonicalPath
            val entry = stores[key]
            if (entry?.album === this) {
                entry.references--
                if (entry.references > 0) return
                stores.remove(key)
            }
            db.close()
        }
    }

    @Synchronized
    fun acceptRemote(remote: JSONObject, expectedRevision: Long): Boolean {
        if (revision() != expectedRevision || pending() != 0) return false
        remote.getJSONArray("photos")
        remote.getJSONArray("visits")
        if (remote.toString() == atlas().toString()) return true
        transaction { write(remote) }
        mirrorBestEffort()
        return true
    }

    @Synchronized
    fun upload(mutation: Mutation): Upload {
        val photo = mutation.body
        val bytes =
            photo(photo.getString("id"))
                ?: throw IOException("A pending photo is missing. Your other changes are saved.")
        val boundary = "Worldwide" + UUID.randomUUID().toString().replace("-", "")
        val out = ByteArrayOutputStream()
        for (field in listOf("countryId", "caption", "width", "height")) part(
            out,
            boundary,
            field,
            photo.optString(field),
        )
        part(out, boundary, "photoId", photo.getString("id"))
        part(out, boundary, "photo", mime = bytes.mime, bytes = bytes.bytes)
        out.write("--$boundary--\r\n".toByteArray())
        return Upload("multipart/form-data; boundary=$boundary", out.toByteArray())
    }

    private class Part(val bytes: ByteArray, val mime: String)

    private fun field(parts: Map<String, Part>, name: String) =
        parts[name]?.bytes?.toString(Charsets.UTF_8) ?: ""

    private fun dimension(value: String): Int {
        val n =
            if (value.isEmpty()) 0
            else value.toIntOrNull() ?: throw ApiException(400, "Invalid photo dimensions.")
        requireValue(n in 0..16384, "Invalid photo dimensions.")
        return n
    }

    private fun multipart(type: String, bytes: ByteArray): Map<String, Part> {
        val match = Regex("boundary=(?:\"([^\"]+)\"|([^;\\s]+))").find(type)
        requireValue(type.startsWith("multipart/form-data") && match != null, "Choose a photo.")
        val boundary = match!!.groupValues[1].ifEmpty { match.groupValues[2] }
        requireValue(boundary.length <= 200, "Invalid upload.")
        val data = bytes.toString(Charsets.ISO_8859_1)
        val marker = "--$boundary"
        val result = mutableMapOf<String, Part>()
        var offset = 0
        while (data.startsWith(marker, offset)) {
            offset += marker.length
            if (data.startsWith("--", offset)) break
            requireValue(data.startsWith("\r\n", offset), "Invalid upload.")
            offset += 2
            val end = data.indexOf("\r\n\r\n", offset)
            requireValue(end >= offset && end - offset < 8192, "Invalid upload.")
            val header = data.substring(offset, end)
            val next = data.indexOf("\r\n$marker", end + 4)
            requireValue(next >= 0, "Invalid upload.")
            val name =
                Regex("(?:^|;)\\s*name=\"([^\"]+)\"", RegexOption.MULTILINE)
                    .find(header.substringAfter(':'))
                    ?: throw ApiException(400, "Invalid upload field.")
            val mime =
                Regex(
                        "^Content-Type:\\s*([^\\r\\n;]+)",
                        setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE),
                    )
                    .find(header)
                    ?.groupValues
                    ?.get(1)
                    ?.trim() ?: ""
            result[name.groupValues[1]] = Part(bytes.copyOfRange(end + 4, next), mime)
            offset = next + 2
        }
        requireValue(result.isNotEmpty(), "Invalid upload.")
        return result
    }

    companion object {
        private class Shared(val album: LocalAlbum, var references: Int = 1)

        private val stores = mutableMapOf<String, Shared>()

        /** Activities reopening during a save share one journal and its transaction monitor. */
        @JvmStatic
        fun open(directory: File, linked: Boolean, countries: Set<String>): LocalAlbum =
            synchronized(stores) {
                val key = directory.canonicalPath
                stores[key]?.let {
                    it.references++
                    return@synchronized it.album
                }
                LocalAlbum(directory, linked, countries).also { stores[key] = Shared(it) }
            }

        @JvmStatic
        fun key(path: String) =
            MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString("") {
                "%02x".format(it)
            }

        private fun atomic(destination: File, bytes: ByteArray) =
            atomicWrite(destination) { it.write(bytes) }

        private fun atomicWrite(destination: File, write: (FileOutputStream) -> Unit) {
            val temp = File.createTempFile("local-", ".tmp", destination.parentFile)
            try {
                FileOutputStream(temp).use {
                    write(it)
                    it.fd.sync()
                }
                Files.move(
                    temp.toPath(),
                    destination.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
                val folder = Os.open(destination.parent, OsConstants.O_RDONLY, 0)
                try {
                    Os.fsync(folder)
                } finally {
                    Os.close(folder)
                }
            } finally {
                temp.delete()
            }
        }

        private fun objects(values: JSONArray) =
            (0 until values.length()).map { values.getJSONObject(it) }

        private fun find(values: JSONArray, key: String, value: String) =
            objects(values).indexOfFirst { it.optString(key) == value }

        private fun requireValue(value: Boolean, message: String) {
            if (!value) throw ApiException(400, message)
        }

        private fun json(status: Int, value: JSONObject) =
            Reply(status, "application/json", value.toString().toByteArray())

        private fun visitPatch(value: JSONObject) =
            JSONObject()
                .put("visited", value.optInt("visited") == 1 || value.optBoolean("visited"))
                .put("coverId", value.opt("coverId"))
                .put("note", value.optString("note"))
                .put("visitDate", value.opt("visitDate"))

        private fun part(
            out: ByteArrayOutputStream,
            boundary: String,
            name: String,
            value: String = "",
            mime: String? = null,
            bytes: ByteArray? = null,
        ) {
            out.write(
                "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"${if(bytes==null)"" else "; filename=\"photo\""}\r\n${if(mime==null)"" else "Content-Type: $mime\r\n"}\r\n"
                    .toByteArray()
            )
            out.write(bytes ?: value.toByteArray())
            out.write("\r\n".toByteArray())
        }

        private fun validImage(type: String, bytes: ByteArray): Boolean {
            if (bytes.size < 12) return false
            val prefix = bytes.copyOfRange(0, minOf(bytes.size, 32)).toString(Charsets.ISO_8859_1)
            return type == "image/jpeg" &&
                (bytes[0].toInt() and 255) == 255 &&
                (bytes[1].toInt() and 255) == 216 ||
                type == "image/png" &&
                    (bytes[0].toInt() and 255) == 137 &&
                    bytes[1].toInt() == 80 ||
                type == "image/webp" &&
                    prefix.startsWith("RIFF") &&
                    prefix.substring(8).startsWith("WEBP") ||
                type == "image/gif" && prefix.startsWith("GIF") ||
                type == "image/avif" &&
                    prefix.substring(4).startsWith("ftyp") &&
                    (prefix.contains("avif") || prefix.contains("avis"))
        }
    }
}
