import {
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from "@nestjs/common";
import { APP_INTERCEPTOR, ModuleRef, ContextIdFactory } from "@nestjs/core";
import { GqlExecutionContext } from "@nestjs/graphql";
import * as DataLoader from "dataloader";
import { Observable } from "rxjs";
import { idText } from "typescript";

export interface NestDataLoader<ID, Type> {
  // 自定义的DataLoader需要实现的方法, 需要返回一个DataLoader实例(也就是说你要准备好batchLoadFn)
  generateDataLoader(): DataLoader<ID, Type>;
}

/**
 * 注入方式:
 * {
 *     provide: APP_INTERCEPTOR,
 *     useClass: DataLoaderInterceptor,
 * },
 */
const NEST_LOADER_CONTEXT_KEY: string = "NEST_LOADER_CONTEXT_KEY";

@Injectable()
export class DataLoaderInterceptor implements NestInterceptor {
  // 获取到模块引用 见https://docs.nestjs.com/fundamentals/module-ref
  constructor(private readonly moduleRef: ModuleRef) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // GraphQL的执行上下文, 这一点需要和Nest的上下文区分开来
    const graphqlExecutionContext = GqlExecutionContext.create(context);
    const ctx = graphqlExecutionContext.getContext();

    if (ctx[NEST_LOADER_CONTEXT_KEY] === undefined) {
      ctx[NEST_LOADER_CONTEXT_KEY] = {
        // 上下文标识, 确保始终返回的是唯一实例
        contextId: ContextIdFactory.create(),
        getLoader: (type: string): Promise<NestDataLoader<any, any>> => {
          // 如果当前loader未在上下文中注册 则生成DataLoader实例并进行注册
          if (ctx[type] === undefined) {
            try {
              // 右边的IIFE返回一个DataLoader实例, 并注册到全局上下文
              ctx[type] = (async () => {
                return (
                  // 使用resolve而不是get, 因为DataLoader需要是request-scoped, 即为每个请求创建一个新的实例
                  (
                    await this.moduleRef.resolve<NestDataLoader<any, any>>(
                      type,
                      ctx[NEST_LOADER_CONTEXT_KEY].contextId,
                      // 从全局上下文获取
                      { strict: false }
                    )
                  ).generateDataLoader()
                );
              })();
            } catch (e) {
              throw new InternalServerErrorException(
                `The loader ${type} is not provided` + e
              );
            }
          }
          // 若loader已注册则返回
          return ctx[type];
        },
      };
    }
    return next.handle();
  }
}

// 注入loader到GraphQL Resolver中
// @Loader(AccountLoader.name) accountLoader: DataLoader<Account['id'], Account>
export const Loader = createParamDecorator(
  async (data: any, context: ExecutionContext & { [key: string]: any }) => {
    const ctx: any = GqlExecutionContext.create(context).getContext();
    if (ctx[NEST_LOADER_CONTEXT_KEY] === undefined) {
      throw new InternalServerErrorException(`
            You should provide interceptor ${DataLoaderInterceptor.name} globally with ${APP_INTERCEPTOR}
          `);
    }
    // 所有loader都被保存在此命名空间下
    return await ctx[NEST_LOADER_CONTEXT_KEY].getLoader(data);
  }
);
