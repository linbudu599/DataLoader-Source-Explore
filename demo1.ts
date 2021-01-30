import { ApolloServer, gql } from "apollo-server";
// import DataLoader from "./dataloader";
import DataLoader from "./tiny";

import chalk from "chalk";

const typeDefs = gql`
  type Query {
    fetchUserByName(name: String!): User
    fetchAllUsers: [User]
  }

  type User {
    id: Int!
    name: String!
    partner: User
    pets: [Pet]
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

    getUsersByIds: (ids: number[]) =>
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

    getPetsByIds: (ids: number[]) =>
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
    users: DataLoader<number, IUser, number>;
    pets: DataLoader<number, IPet, number>;
  };
};

const resolvers = {
  Query: {
    fetchUserByName(root, { name }: { name: string }, { service }: IContext) {
      return service.getUserByName(name);
    },
    fetchAllUsers(root, args, { service }: IContext) {
      return service.getAllUsers();
    },
  },
  User: {
    async partner(user: IUser, args, { dataloaders }: IContext) {
      // return mockService.getUserById(user.partnerId);
      return dataloaders.users.load(user.partnerId);
    },
    async pets(user: IUser, args, { dataloaders }: IContext) {
      // return mockService.getPetsByIds(user.petsId);
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
        users: new DataLoader(async (userIds: Readonly<number[]>) => {
          console.log("Received User IDs");
          console.log(userIds);
          const users = await mockService.getUsersByIds(userIds as number[]);
          // console.log(
          //   users.sort(
          //     (prev, curr) =>
          //       userIds.indexOf(prev.id) - userIds.indexOf(curr.id)
          //   )
          // );
          return users.sort(
            (prev, curr) => userIds.indexOf(prev.id) - userIds.indexOf(curr.id)
          );
        }),
        pets: new DataLoader(
          async (petIds: Readonly<number[]>) => {
            console.log("Received Pet IDs");
            console.log(petIds);
            const pets = await mockService.getPetsByIds(petIds as number[]);
            // console.log("Returned Pet Res");
            // console.log(pets);
            // console.log("Sorted Pet Res(as param order)");
            // console.log(
            //   pets.sort(
            //     (prev, curr) =>
            //       petIds.indexOf(prev.id) - petIds.indexOf(curr.id)
            //   )
            // );
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

server.listen(4545).then(({ url }) => {
  console.log(chalk.greenBright(`Apollo GraphQL Server ready at ${url}`));
});
