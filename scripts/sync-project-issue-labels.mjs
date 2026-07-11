#!/usr/bin/env node

import { assertNoManagedLabelConflicts } from "./project-sync-policy.mjs";

const DEFAULT_REPO = "ResonantOS/2.0.0-alpha";
const DEFAULT_PROJECT_OWNER = "ResonantOS";
const DEFAULT_PROJECT_NUMBER = 2;

const SCOPE_FIELD = "Release Scope";
const AREA_FIELD = "Area";
const STATUS_FIELD = "Status";
const INBOX_STATUS = "Inbox";

const scopeToLabel = new Map([
  ["Alpha MVP", "scope:alpha-mvp"],
  ["Community Test", "scope:community-test"],
  ["Deferred / Waived", "scope:deferred"],
  ["Experimental", "scope:experimental"],
  ["Native Future", "scope:native-future"],
  ["Legacy", "scope:legacy"],
]);

const areaToLabel = new Map([
  ["Bridge", "area:bridge"],
  ["Extension", "area:extension"],
  ["Chat", "area:chat"],
  ["Settings", "area:settings"],
  ["Hermes", "area:hermes"],
  ["OpenCode", "area:opencode"],
  ["Living Archive", "area:living-archive"],
  ["Blackboard", "area:blackboard"],
  ["Build", "area:build"],
  ["Security", "area:security"],
  ["Docs", "area:docs"],
  ["Legacy", "area:legacy"],
]);

const labelToScope = invertMap(scopeToLabel);
const labelToArea = invertMap(areaToLabel);
const managedScopeLabels = new Set(scopeToLabel.values());
const managedAreaLabels = new Set(areaToLabel.values());

const args = parseArgs(process.argv.slice(2));
const dryRun = args.has("dry-run");
const repo = args.get("repo") ?? DEFAULT_REPO;
const projectOwner = args.get("owner") ?? DEFAULT_PROJECT_OWNER;
const projectNumber = Number(args.get("project") ?? DEFAULT_PROJECT_NUMBER);
const [repoOwner, repoName] = repo.split("/");

if (!repoOwner || !repoName) {
  fail(`Invalid repo "${repo}". Expected owner/name.`);
}

const token =
  process.env.PROJECT_SYNC_TOKEN ||
  process.env.GH_TOKEN ||
  process.env.GITHUB_TOKEN;

if (!token) {
  fail("Missing PROJECT_SYNC_TOKEN, GH_TOKEN, or GITHUB_TOKEN.");
}

const summary = {
  addedToProject: 0,
  fieldsUpdatedFromLabels: 0,
  labelsAdded: 0,
  labelsRemoved: 0,
  skippedWithoutFields: 0,
};

let project;
try {
  project = await getProject(projectOwner, projectNumber);
} catch (error) {
  if (isProjectAccessError(error)) {
    fail(
      [
        `Project ${projectOwner}/${projectNumber} is not visible to the token used by this run.`,
        "For GitHub Actions, configure the repository secret PROJECT_SYNC_TOKEN",
        "with repo issue/PR access and organization Project read/write access.",
      ].join(" "),
    );
  }
  throw error;
}
const requiredFields = getRequiredFields(project);
const projectItems = await listProjectItems(projectOwner, projectNumber);
const contentIdToProjectItem = new Map(
  projectItems
    .filter((item) => isTargetContent(item.content))
    .map((item) => [item.content.id, item]),
);

const openItems = await listOpenIssuesAndPullRequests(repoOwner, repoName);
const syncCandidates = openItems.map((item) => {
  const projectItem = contentIdToProjectItem.get(item.node_id);
  const fields = projectItem ? readSingleSelectFieldValues(projectItem) : new Map();
  return {
    url: item.html_url,
    labels: item.labels.map((label) => label.name),
    releaseScope: fields.get(SCOPE_FIELD) ?? "",
    area: fields.get(AREA_FIELD) ?? "",
  };
});
assertNoManagedLabelConflicts(syncCandidates, {
  scopeLabels: managedScopeLabels,
  areaLabels: managedAreaLabels,
});

for (const item of openItems) {
  if (contentIdToProjectItem.has(item.node_id)) {
    continue;
  }

  const projectItem = await addIssueOrPullRequestToProject(project.id, item.node_id, item.html_url);
  const labels = new Set(item.labels.map((label) => label.name));
  await hydrateFieldsFromLabels(project.id, projectItem.id, requiredFields, labels, item.html_url);
  await setInboxStatus(project.id, projectItem.id, requiredFields.status, item.html_url);
  contentIdToProjectItem.set(item.node_id, {
    id: projectItem.id,
    content: {
      id: item.node_id,
      number: item.number,
      title: item.title,
      url: item.html_url,
      state: item.state?.toUpperCase?.() ?? "OPEN",
      repository: { nameWithOwner: repo },
      labels: { nodes: item.labels.map((label) => ({ name: label.name })) },
      __typename: item.pull_request ? "PullRequest" : "Issue",
    },
    fieldValues: { nodes: [] },
  });
}

const refreshedItems = await listProjectItems(projectOwner, projectNumber);
assertNoManagedLabelConflicts(
  refreshedItems
    .filter((item) => isTargetContent(item.content) && item.content.state !== "CLOSED" && item.content.state !== "MERGED")
    .map((item) => {
      const fields = readSingleSelectFieldValues(item);
      return {
        url: item.content.url,
        labels: item.content.labels.nodes.map((label) => label.name),
        releaseScope: fields.get(SCOPE_FIELD) ?? "",
        area: fields.get(AREA_FIELD) ?? "",
      };
    }),
  {
    scopeLabels: managedScopeLabels,
    areaLabels: managedAreaLabels,
  },
);

for (const item of refreshedItems) {
  if (!isTargetContent(item.content) || item.content.state === "CLOSED" || item.content.state === "MERGED") {
    continue;
  }

  const fieldValues = readSingleSelectFieldValues(item);
  const labels = new Set(item.content.labels.nodes.map((label) => label.name));
  const inferred = await hydrateFieldsFromLabels(
    project.id,
    item.id,
    requiredFields,
    labels,
    item.content.url,
    fieldValues,
  );

  if (inferred.changed) {
    continue;
  }

  const desiredLabels = [];
  const releaseScope = fieldValues.get(SCOPE_FIELD);
  const area = fieldValues.get(AREA_FIELD);

  if (releaseScope && scopeToLabel.has(releaseScope)) {
    desiredLabels.push(scopeToLabel.get(releaseScope));
  }

  if (area && areaToLabel.has(area)) {
    desiredLabels.push(areaToLabel.get(area));
  }

  if (desiredLabels.length === 0) {
    summary.skippedWithoutFields += 1;
    continue;
  }

  await reconcileManagedLabels(repoOwner, repoName, item.content.number, labels, desiredLabels, item.content.url);
}

console.log(
  [
    "Project issue sync complete.",
    `dryRun=${dryRun}`,
    `addedToProject=${summary.addedToProject}`,
    `fieldsUpdatedFromLabels=${summary.fieldsUpdatedFromLabels}`,
    `labelsAdded=${summary.labelsAdded}`,
    `labelsRemoved=${summary.labelsRemoved}`,
    `skippedWithoutFields=${summary.skippedWithoutFields}`,
  ].join(" "),
);

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument "${arg}".`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(rawKey, "true");
      continue;
    }

    parsed.set(rawKey, next);
    index += 1;
  }

  return parsed;
}

function invertMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [value, key]));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isProjectAccessError(error) {
  return /Could not resolve to a ProjectV2|Project .* was not found/.test(String(error?.message ?? error));
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function githubGraphql(query, variables = {}) {
  const response = await githubRequest("/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });

  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message).join("; "));
  }

  return response.data;
}

async function getProject(owner, number) {
  const data = await githubGraphql(
    `query Project($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2FieldCommon {
                id
                name
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }`,
    { owner, number },
  );

  const project = data.organization?.projectV2;
  if (!project) {
    fail(`Project ${owner}/${number} was not found.`);
  }

  return project;
}

function getRequiredFields(project) {
  const fields = new Map(project.fields.nodes.filter(Boolean).map((field) => [field.name, field]));
  const missing = [SCOPE_FIELD, AREA_FIELD, STATUS_FIELD].filter((field) => !fields.has(field));
  if (missing.length) {
    fail(`Project is missing required fields: ${missing.join(", ")}`);
  }

  return {
    releaseScope: fields.get(SCOPE_FIELD),
    area: fields.get(AREA_FIELD),
    status: fields.get(STATUS_FIELD),
  };
}

async function listProjectItems(owner, number) {
  const items = [];
  let after = null;

  do {
    const data = await githubGraphql(
      `query ProjectItems($owner: String!, $number: Int!, $after: String) {
        organization(login: $owner) {
          projectV2(number: $number) {
            items(first: 100, after: $after) {
              nodes {
                id
                content {
                  __typename
                  ... on Issue {
                    id
                    number
                    title
                    url
                    state
                    repository {
                      nameWithOwner
                    }
                    labels(first: 100) {
                      nodes {
                        name
                      }
                    }
                  }
                  ... on PullRequest {
                    id
                    number
                    title
                    url
                    state
                    repository {
                      nameWithOwner
                    }
                    labels(first: 100) {
                      nodes {
                        name
                      }
                    }
                  }
                }
                fieldValues(first: 50) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2FieldCommon {
                          name
                        }
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      { owner, number, after },
    );

    const page = data.organization.projectV2.items;
    items.push(...page.nodes.filter(Boolean));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return items;
}

async function listOpenIssuesAndPullRequests(owner, name) {
  const items = [];
  let page = 1;

  while (true) {
    const pageItems = await githubRequest(
      `/repos/${owner}/${name}/issues?state=open&per_page=100&page=${page}`,
    );
    items.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }

    page += 1;
  }

  return items;
}

function isTargetContent(content) {
  return (
    content &&
    (content.__typename === "Issue" || content.__typename === "PullRequest") &&
    content.repository?.nameWithOwner === repo
  );
}

function readSingleSelectFieldValues(item) {
  const values = new Map();
  for (const value of item.fieldValues.nodes) {
    if (value?.__typename !== "ProjectV2ItemFieldSingleSelectValue") {
      continue;
    }
    values.set(value.field.name, value.name);
  }
  return values;
}

async function addIssueOrPullRequestToProject(projectId, contentId, url) {
  summary.addedToProject += 1;
  logAction(`add to Project 2: ${url}`);
  if (dryRun) {
    return { id: `dry-run-${contentId}` };
  }

  const data = await githubGraphql(
    `mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }`,
    { projectId, contentId },
  );

  return data.addProjectV2ItemById.item;
}

async function hydrateFieldsFromLabels(projectId, itemId, fields, labels, url, currentFieldValues = new Map()) {
  if (String(itemId).startsWith("dry-run-")) {
    return { changed: false };
  }

  let changed = false;
  const scopeLabel = [...labels].find((label) => labelToScope.has(label));
  const areaLabel = [...labels].find((label) => labelToArea.has(label));

  if (scopeLabel && !currentFieldValues.has(SCOPE_FIELD)) {
    await setSingleSelectField(projectId, itemId, fields.releaseScope, labelToScope.get(scopeLabel), url);
    changed = true;
  }

  if (areaLabel && !currentFieldValues.has(AREA_FIELD)) {
    await setSingleSelectField(projectId, itemId, fields.area, labelToArea.get(areaLabel), url);
    changed = true;
  }

  if (changed) {
    summary.fieldsUpdatedFromLabels += 1;
  }

  return { changed };
}

async function setInboxStatus(projectId, itemId, statusField, url) {
  if (String(itemId).startsWith("dry-run-")) {
    return;
  }

  await setSingleSelectField(projectId, itemId, statusField, INBOX_STATUS, url);
}

async function setSingleSelectField(projectId, itemId, field, optionName, url) {
  const option = field.options.find((candidate) => candidate.name === optionName);
  if (!option) {
    throw new Error(`Project field "${field.name}" is missing option "${optionName}".`);
  }

  logAction(`set ${field.name}=${optionName}: ${url}`);
  if (dryRun) {
    return;
  }

  await githubGraphql(
    `mutation SetProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item {
          id
        }
      }
    }`,
    { projectId, itemId, fieldId: field.id, optionId: option.id },
  );
}

async function reconcileManagedLabels(owner, name, number, currentLabels, desiredLabels, url) {
  const desired = new Set(desiredLabels);
  const toRemove = [
    ...[...managedScopeLabels].filter((label) => currentLabels.has(label) && !desired.has(label)),
    ...[...managedAreaLabels].filter((label) => currentLabels.has(label) && !desired.has(label)),
  ];
  const toAdd = [...desired].filter((label) => !currentLabels.has(label));

  for (const label of toRemove) {
    summary.labelsRemoved += 1;
    logAction(`remove label ${label}: ${url}`);
    if (!dryRun) {
      await githubRequest(`/repos/${owner}/${name}/issues/${number}/labels/${encodeURIComponent(label)}`, {
        method: "DELETE",
      });
    }
  }

  if (toAdd.length) {
    summary.labelsAdded += toAdd.length;
    logAction(`add labels ${toAdd.join(", ")}: ${url}`);
    if (!dryRun) {
      await githubRequest(`/repos/${owner}/${name}/issues/${number}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: toAdd }),
      });
    }
  }
}

function logAction(message) {
  console.log(`${dryRun ? "[dry-run] " : ""}${message}`);
}
