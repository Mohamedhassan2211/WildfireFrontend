using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using WildfireApi.Models;

namespace WildfireApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class FiresController : ControllerBase
    {
        private static readonly string FilePath =
            Path.Combine(Directory.GetCurrentDirectory(), "saved_fires.json");

        // camelCase + PropertyNameCaseInsensitive = true
        private static readonly JsonSerializerOptions JsonOpts =
            new(JsonSerializerDefaults.Web) { WriteIndented = true };

        // Simple lock to avoid concurrent write conflicts
        private static readonly object _fileLock = new();

        // -----------------------------------------------------------
        // POST /api/fires — append new fires without deleting old ones
        // -----------------------------------------------------------
        [HttpPost]
        public IActionResult SaveFires([FromBody] List<FireModel> newFires)
        {
            if (newFires is null || newFires.Count == 0)
                return BadRequest(new { message = "No data to save." });

            lock (_fileLock)
            {
                var existing = ReadAll();
                existing.AddRange(newFires);

                System.IO.File.WriteAllText(
                    FilePath,
                    JsonSerializer.Serialize(existing, JsonOpts));
            }

            return Ok(new
            {
                message = "Data saved successfully.",
                savedCount = newFires.Count
            });
        }

        // -----------------------------------------------------------
        // GET /api/fires — return all saved fires
        // -----------------------------------------------------------
        [HttpGet]
        public IActionResult GetFires() => Ok(ReadAll());

        // -----------------------------------------------------------
        // DELETE /api/fires/{id} — remove a single fire by id
        // -----------------------------------------------------------
        [HttpDelete("{id:long}")]
        public IActionResult DeleteFire(long id)
        {
            bool removed;

            lock (_fileLock)
            {
                var existing = ReadAll();
                var match = existing.FirstOrDefault(f => f.Id == id);

                if (match is null) return NotFound(new { message = "Fire not found." });

                existing.Remove(match);
                removed = true;

                System.IO.File.WriteAllText(
                    FilePath,
                    JsonSerializer.Serialize(existing, JsonOpts));
            }

            return removed
                ? Ok(new { message = "Fire deleted successfully.", id })
                : NotFound(new { message = "Fire not found." });
        }

        // -----------------------------------------------------------
        // Helper: read all fires from the JSON file
        // -----------------------------------------------------------
        private static List<FireModel> ReadAll()
        {
            if (!System.IO.File.Exists(FilePath))
                return new List<FireModel>();

            var json = System.IO.File.ReadAllText(FilePath);
            if (string.IsNullOrWhiteSpace(json))
                return new List<FireModel>();

            return JsonSerializer.Deserialize<List<FireModel>>(json, JsonOpts)
                   ?? new List<FireModel>();
        }
    }
}