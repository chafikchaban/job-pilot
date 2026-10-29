pub fn generate_queries(target_roles: &[String], regions: &[String]) -> Vec<String> {
    let mut queries = Vec::new();
    for role in target_roles {
        for region in regions {
            queries.push(format!("{} job {} remote", role, region));
            queries.push(format!("{} stelle {} remote", role, region));
        }
    }
    queries
}
