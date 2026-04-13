fn main() {
    let geocoder = reverse_geocoder::ReverseGeocoder::new();
    let result = geocoder.search((47.6062, -122.3321)); // Seattle
    println!("name: {}", result.record.name);
    println!("admin1: {}", result.record.admin1);
    println!("admin2: {}", result.record.admin2);
    println!("cc: {}", result.record.cc);
}
