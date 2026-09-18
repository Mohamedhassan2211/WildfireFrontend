namespace WildfireApi.Models
{
    public class FireModel
    {
        public long Id { get; set; }
        public Dictionary<string, object> Attributes { get; set; } = new();
        public GeometryModel Geometry { get; set; } = new();
    }

    public class GeometryModel
    {
        public double X { get; set; }
        public double Y { get; set; }
    }
}