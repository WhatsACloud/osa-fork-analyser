export const PROJECT_INFO_QUERY = `
query($baseOwner: String!, $baseRepo: String!, $forkOwner: String!, $forkRepo: String!) {
  base: repository(owner: $baseOwner, name: $baseRepo) {
    description
    defaultBranchRef { name }
  }
  fork: repository(owner: $forkOwner, name: $forkRepo) {
    description
    defaultBranchRef { name }
  }
}`;

export const SUBMODULES_QUERY = `
query($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        object(expression: "HEAD:.gitmodules") {
          ... on Blob { text }
        }
      }
    }
  }
}`;

export const OWNER_REPOS_QUERY = `
query($username: String!, $count: Int!, $after: String) {
  repositoryOwner(login: $username) {
    repositories(first: $count, privacy: PUBLIC, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        name url description isArchived
        refs(refPrefix: "refs/heads/", first: 10) {
          nodes { name target { ... on Commit { committedDate } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
