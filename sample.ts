import { ApolloServer, gql } from "apollo-server";
// import DataLoader from "./dataloader";
// import DataLoader from "./batch-only-loader";
import DataLoader from "./tiny";

import chalk from "chalk";

const typeDefs = gql`
  type Query {
    fetchAllUsers: [User]
    fetchUserByName(name: String!): User
  }

  type User {
    id: Int!
    name: String!
    partner: User
    batchLoadPartner: User
    pets: [Pet]
    batchLoadPets: [Pet]
  }

  type Pet {
    id: Int!
    kind: String!
    age: Int!
    isMale: Boolean!
  }
`;

interface IUser {
  id: number;
  name: string;
  partnerId: number;
  petsId: number[];
}

interface IPet {
  id: number;
  kind: string;
  age: number;
  isMale: boolean;
}

const promiseWrapper = <T>(value: T, indicator: string): Promise<T> =>
  new Promise((resolve) => {
    setTimeout(() => {
      console.log(chalk.cyanBright(indicator));
      return resolve(value);
    }, 200);
  });

const mockService = (() => {
  const users: IUser[] = [
    { id: 1, name: "AAA", partnerId: 2, petsId: [2, 3, 4] },
    { id: 2, name: "BBB", partnerId: 3, petsId: [1, 3, 4, 5] },
    { id: 3, name: "CCC", partnerId: 4, petsId: [1, 2, 5] },
    { id: 4, name: "DDD", partnerId: 5, petsId: [1, 2, 5] },
    { id: 5, name: "EEE", partnerId: 1, petsId: [2, 3, 4] },
  ];

  const pets: IPet[] = [
    {
      id: 1,
      kind: "Cat",
      age: 3,
      isMale: false,
    },
    {
      id: 2,
      kind: "Dog",
      age: 6,
      isMale: true,
    },
    {
      id: 3,
      kind: "Bird",
      age: 2,
      isMale: false,
    },
    {
      id: 4,
      kind: "Snake",
      age: 5,
      isMale: false,
    },
    {
      id: 5,
      kind: "Rabbit",
      age: 4,
      isMale: true,
    },
  ];

  return {
    getUserById: (id: number) =>
      promiseWrapper(
        users.find((user) => user.id === id),
        `getUserById: ${id}`
      ),

    getUserByName: (name: string) =>
      promiseWrapper(
        users.find((user) => user.name === name),
        `getUserByName: ${name}`
      ),

    getUsersByIds: (ids: readonly number[]) =>
      promiseWrapper(
        users.filter((user) => ids.includes(user.id)),
        `getUsersByIds: ${ids}`
      ),

    getAllUsers: () => promiseWrapper(users, "getAllUsers"),

    getPetById: (id: number) =>
      promiseWrapper(
        pets.find((pet) => pet.id === id),
        `getPetById: ${id}`
      ),

    getPetsByIds: (ids: readonly number[]) =>
      promiseWrapper(
        pets.filter((pet) => ids.includes(pet.id)),
        `getPetsByIds: ${ids}`
      ),

    getAllPets: () => promiseWrapper(pets, "getAllPtes"),
  };
})();

type ServiceType = typeof mockService;

type IContext = {
  service: ServiceType;
  dataloaders: {
    users: DataLoader<number, IUser>;
    pets: DataLoader<number, IPet>;
  };
};

const resolvers = {
  Query: {
    fetchUserByName(
      _root: undefined,
      { name }: { name: string },
      { service }: IContext
    ) {
      return service.getUserByName(name);
    },
    fetchAllUsers(_root: undefined, _args: undefined, { service }: IContext) {
      return service.getAllUsers();
    },
  },
  User: {
    async partner(user: IUser, _args: undefined, { service }: IContext) {
      return service.getUserById(user.partnerId);
    },
    async batchLoadPartner(
      user: IUser,
      _args: undefined,
      { dataloaders }: IContext
    ) {
      return dataloaders.users.load(user.partnerId);
    },
    async pets(user: IUser, _args: undefined, { service }: IContext) {
      return service.getPetsByIds(user.petsId);
    },
    async batchLoadPets(
      user: IUser,
      _args: undefined,
      { dataloaders }: IContext
    ) {
      return dataloaders.pets.loadMany(user.petsId);
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  tracing: true,
  context: async () => {
    return {
      service: mockService,
      dataloaders: {
        // user的批处理函数
        users: new DataLoader(async (userIds: Readonly<number[]>) => {
          console.log("DataLoader Received User IDs");
          console.log(userIds);
          const users = await mockService.getUsersByIds(userIds);
          return users.sort(
            (prev, curr) => userIds.indexOf(prev.id) - userIds.indexOf(curr.id)
          );
        }),
        pets: new DataLoader(
          async (petIds: Readonly<number[]>) => {
            console.log("DataLoader Received Pet IDs");
            console.log(petIds);
            const pets = await mockService.getPetsByIds(petIds);
            // console.log("Returned Pet Res");
            // console.log(pets);
            return pets.sort(
              (prev, curr) => petIds.indexOf(prev.id) - petIds.indexOf(curr.id)
            );
          }
          // { batch: true, cache: true }
        ),
      },
    };
  },
  playground: {
    settings: {
      "editor.fontSize": 16,
      "editor.fontFamily": "Fira Code",
    },
  },
});

server.listen(7878).then(({ url }) => {
  console.log(chalk.greenBright(`Apollo GraphQL Server ready at ${url}`));
});
