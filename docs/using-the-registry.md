# Using The Graph Networks Registry

This guide explains how to integrate and use The Graph Networks Registry in your application.

## Getting Started

The links to both the latest Registry JSON and JSON Schema can be found on the [GitHub Releases](https://github.com/graphprotocol/networks-registry/releases) page.

## Versioning

- MAJOR version changes indicate breaking schema changes
- MINOR version changes add new optional fields or enum values
- PATCH version changes add or update network information

The registry is available at several URLs depending on your versioning needs.

- Use the latest version if you want the most up-to-date data and can handle breaking schema changes: `TheGraphNetworksRegistry.json`
- Use the latest major version to avoid breaking schema changes: `TheGraphNetworksRegistry_v1_x_x.json`
- Use the latest minor version if you want to stay on the same schema: `TheGraphNetworksRegistry_v1_2_x.json`
- Use a specific version if you want to pin to a specific registry version: `TheGraphNetworksRegistry_v1_2_3.json`

More details on versioning can be found in the [README](https://github.com/graphprotocol/networks-registry#versioning).

## Best Practices

- Use type generation from the JSON Schema for better development experience
- Avoid loading the registry on the client side more than once- it can be quite large
- Cache the registry appropriately for your use case - it doesn't change often

## Integration

To generate types from the corresponding JSON Schema, use the one of the many available tools:

- [quicktype](https://github.com/quicktype/quicktype) for many languages

```
> npx quicktype --lang go \
  --visibility public \
  TheGraphNetworksRegistrySchema_v1_0.json \
  -o registry.rs

```

- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript) for typescript

```
> npx json-schema-to-typescript \
  --input TheGraphNetworksRegistrySchema_v1_0.json \
  --output types/registry.d.ts
```

- [typify](https://github.com/oxidecomputer/typify) for Rust
