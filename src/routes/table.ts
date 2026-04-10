// @ts-nocheck
import {
  fetchPageById,
  fetchTableData,
  fetchNotionUsers,
} from "../notion-api/notion.js";
import { parsePageId, getNotionValue } from "../notion-api/utils.js";
import {
  RowContentType,
  CollectionType,
  RowType,
  HandlerRequest,
} from "../notion-api/types.js";
import { createResponse } from "../utils/response.js";
import { getNotionToken } from "../utils/index.js";

export const getTableData = async (
  collection: CollectionType,
  collectionViewId: string,
  notionToken?: string,
  raw?: boolean
) => {
  const table = await fetchTableData(
    collection.value.id,
    collectionViewId,
    notionToken
  );

  let collectionRows = collection.value.schema;
  if (!collectionRows) {
    // Fall back to schema from queryCollection response
    const collectionId = collection.value.id;
    const tableCollection = table.recordMap?.collection?.[collectionId];
    collectionRows = tableCollection?.value?.schema;
  }
  if (!collectionRows) {
    return { rows: [], schema: {} };
  }
  const collectionColKeys = Object.keys(collectionRows);

  const blockIds =
    table.result?.reducerResults?.collection_group_results?.blockIds ?? [];
  const tableArr: RowType[] = blockIds.map(
    (id: string) => table.recordMap?.block?.[id]?.value
  );

  const tableData = tableArr.filter(
    (b) =>
      b.value && b.value.properties && b.value.parent_id === collection.value.id
  );

  type Row = { id: string; [key: string]: RowContentType };

  const rows: Row[] = [];

  for (const td of tableData) {
    let row: Row = { id: td.value.id };

    for (const key of collectionColKeys) {
      const val = td.value.properties[key];
      if (val) {
        const schema = collectionRows[key];
        row[schema.name] = raw ? val : getNotionValue(val, schema.type, td);
        if (schema.type === "person" && row[schema.name]) {
          const users = await fetchNotionUsers(row[schema.name] as string[]);
          row[schema.name] = users as any;
        }
      }
    }
    rows.push(row);
  }

  return { rows, schema: collectionRows };
};

export async function tableRoute(c: HandlerRequest) {
  const pageId = parsePageId(c.req.param("pageId"));
  const notionToken = getNotionToken(c);
  const page = await fetchPageById(pageId!, notionToken);

  if (!page.recordMap.collection)
    return createResponse(
      JSON.stringify({ error: "No table found on Notion page: " + pageId }),
      { headers: {}, statusCode: 401, request: c }
    );

  const rawCollection = Object.keys(page.recordMap.collection).map(
    (k) => page.recordMap.collection[k]
  )[0];

  // Handle new Notion API format with double-nested value
  const collection: CollectionType = rawCollection.value?.value
    ? { value: rawCollection.value.value }
    : rawCollection;

  const rawCollectionView = Object.keys(page.recordMap.collection_view).map(
    (k) => page.recordMap.collection_view[k]
  )[0];

  const collectionView: {
    value: { id: CollectionType["value"]["id"] };
  } = rawCollectionView.value?.value
    ? { value: rawCollectionView.value.value }
    : rawCollectionView;

  const { rows } = await getTableData(
    collection,
    collectionView.value.id,
    notionToken
  );

  return createResponse(rows, { request: c });
}
