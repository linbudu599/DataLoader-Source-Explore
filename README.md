# DataLoader-Source-Explore

## Quick Start

```bash
yarn
yarn dev
```

打开链接：[http://localhost:7878/](http://localhost:7878/)

使用 [common.graphql](graphql/common.graphql) 的语句发起查询，此操作预期将重复调用 `getUserById` `getPetsByIds` 方法，见终端输出。

使用 [dataloader.graphql](graphql/dataloader.graphql) 的语句发起查询，此操作预期将仅调用批查询方法`getUsersByIds` `getPetsByIds`，见终端输出。

通过最上方的导入来切换示例使用的 DataLoader 实现：

```typescript
// TS 版本
import DataLoader from "./dataloader";
// NPM 版本
import DataLoader from "dataloader";
// 迷你实现版本
import DataLoader from "./tiny";
```

## Includes

- [Original Implementation](source/index.js)
- [x] [DataLoader TS 版本](./dataloader.ts)
- [x] [DataLoader 在 GraphQL 中的实际效果](./sample.ts)
- [x] [DataLoader 源码](./dataloader.ts)
- [x] [DataLoader 迷你实现](tiny.ts)
- [x] [Prisma DataLoader 源码解析](./prisma-dataloader.ts)
- [x] [NestJS-DataLoader 源码解析](./nestjs-dataloader.ts)

## Related

- [GraphQL-Explorer-Server](https://github.com/linbudu599/GraphQL-Explorer-Server)
- [Prisma-Article-Examples](https://github.com/linbudu599/Prisma-Article-Example)
- [NestJS](https://nestjs.com/)
- [NestJS-DataLoader](https://github.com/krislefeber/nestjs-dataloader)
- [GraphQL](https://graphql.org/)
- [TypeGraphQL](https://typegraphql.com/)
- [TypeGraphQL-DataLoader](https://github.com/slaypni/type-graphql-dataloader)
