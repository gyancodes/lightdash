import {
    CompiledDimension,
    CompiledMetricQuery,
    CompiledTable,
    createFilterRuleFromModelRequiredFilterRule,
    DimensionType,
    Explore,
    FieldReferenceError,
    FieldType,
    FilterGroup,
    FilterRule,
    getCustomMetricDimensionId,
    getDimensions,
    getFieldQuoteChar,
    getFieldsFromMetricQuery,
    getFilterRulesFromGroup,
    getItemId,
    IntrinsicUserAttributes,
    isAndFilterGroup,
    isCompiledCustomSqlDimension,
    isCustomBinDimension,
    isFilterGroup,
    isFilterRuleInQuery,
    isJoinModelRequiredFilter,
    ItemsMap,
    MetricFilterRule,
    parseAllReferences,
    renderFilterRuleSql,
    renderFilterRuleSqlFromField,
    renderTableCalculationFilterRuleSql,
    SupportedDbtAdapter,
    TimeFrames,
    UserAttributeValueMap,
    WarehouseClient,
    WeekDay,
} from '@lightdash/common';
import { wrapSentryTransactionSync } from '../../utils';
import {
    assertValidDimensionRequiredAttribute,
    getCustomBinDimensionSql,
    getCustomSqlDimensionSql,
    getDimensionFromFilterTargetId,
    getDimensionFromId,
    getJoinedTables,
    getJoinType,
    getMetricFromId,
    replaceUserAttributesAsStrings,
    replaceUserAttributesRaw,
    sortDayOfWeekName,
    sortMonthName,
} from './utils';

export type CompiledQuery = {
    query: string;
    fields: ItemsMap;
};

export type BuildQueryProps = {
    explore: Explore;
    compiledMetricQuery: CompiledMetricQuery;
    warehouseClient: WarehouseClient;
    userAttributes?: UserAttributeValueMap;
    intrinsicUserAttributes: IntrinsicUserAttributes;
    timezone: string;
};

export const buildQuery = ({
    explore,
    compiledMetricQuery,
    warehouseClient,
    intrinsicUserAttributes,
    userAttributes = {},
    timezone,
}: BuildQueryProps): CompiledQuery =>
    wrapSentryTransactionSync('QueryBuilder.buildQuery', {}, () => {
        const fields = getFieldsFromMetricQuery(compiledMetricQuery, explore);
        const adapterType: SupportedDbtAdapter =
            warehouseClient.getAdapterType();
        const {
            dimensions,
            metrics,
            filters,
            sorts,
            limit,
            additionalMetrics,
            compiledCustomDimensions,
        } = compiledMetricQuery;
        const baseTable = replaceUserAttributesRaw(
            explore.tables[explore.baseTable].sqlTable,
            intrinsicUserAttributes,
            userAttributes,
        );
        const fieldQuoteChar = getFieldQuoteChar(
            warehouseClient.credentials.type,
        );
        const stringQuoteChar = warehouseClient.getStringQuoteChar();
        const escapeStringQuoteChar =
            warehouseClient.getEscapeStringQuoteChar();
        const startOfWeek = warehouseClient.getStartOfWeek();

        // dimensions contains a mix of Dimensions and CustomDimensions,
        // we want to filter customDimensions from this list as we will handle them separately
        const excludeCustomDimensions = (field: string) =>
            !compiledCustomDimensions.map((cd) => cd.id).includes(field);
        const dimensionSelects = dimensions
            .filter(excludeCustomDimensions)
            .map((field) => {
                const alias = field;
                const dimension = getDimensionFromId(
                    field,
                    explore,
                    adapterType,
                    startOfWeek,
                );

                assertValidDimensionRequiredAttribute(
                    dimension,
                    userAttributes,
                    `dimension: "${field}"`,
                );
                return `  ${dimension.compiledSql} AS ${fieldQuoteChar}${alias}${fieldQuoteChar}`;
            });

        const selectedCustomDimensions = compiledCustomDimensions.filter((cd) =>
            dimensions.includes(cd.id),
        );
        const customBinDimensionSql = getCustomBinDimensionSql({
            warehouseClient,
            explore,
            customDimensions:
                selectedCustomDimensions?.filter(isCustomBinDimension),
            intrinsicUserAttributes,
            userAttributes,
            sorts,
        });
        const customSqlDimensionSql = getCustomSqlDimensionSql({
            warehouseClient,
            customDimensions: selectedCustomDimensions?.filter(
                isCompiledCustomSqlDimension,
            ),
        });

        const sqlFrom = `FROM ${baseTable} AS ${fieldQuoteChar}${explore.baseTable}${fieldQuoteChar}`;

        const metricSelects = metrics.map((field) => {
            const alias = field;
            const metric = getMetricFromId(field, explore, compiledMetricQuery);
            return `  ${metric.compiledSql} AS ${fieldQuoteChar}${alias}${fieldQuoteChar}`;
        });

        if (additionalMetrics)
            additionalMetrics.forEach((metric) => {
                if (
                    metric.baseDimensionName === undefined ||
                    !metrics.includes(`${metric.table}_${metric.name}`)
                )
                    return;

                const dimensionId = getCustomMetricDimensionId(metric);
                const dimension = getDimensionFromId(
                    dimensionId,
                    explore,
                    adapterType,
                    startOfWeek,
                );

                assertValidDimensionRequiredAttribute(
                    dimension,
                    userAttributes,
                    `custom metric: "${metric.name}"`,
                );
            });

        const selectedTables = new Set<string>([
            ...metrics.reduce<string[]>((acc, field) => {
                const metric = getMetricFromId(
                    field,
                    explore,
                    compiledMetricQuery,
                );
                return [...acc, ...(metric.tablesReferences || [metric.table])];
            }, []),
            ...dimensions
                .filter(excludeCustomDimensions)
                .reduce<string[]>((acc, field) => {
                    const dim = getDimensionFromId(
                        field,
                        explore,
                        adapterType,
                        startOfWeek,
                    );
                    return [...acc, ...(dim.tablesReferences || [dim.table])];
                }, []),
            ...(customBinDimensionSql?.tables || []),
            ...(customSqlDimensionSql?.tables || []),
            ...getFilterRulesFromGroup(filters.dimensions).reduce<string[]>(
                (acc, filterRule) => {
                    const dim = getDimensionFromFilterTargetId(
                        filterRule.target.fieldId,
                        explore,
                        compiledCustomDimensions.filter(
                            isCompiledCustomSqlDimension,
                        ),
                        adapterType,
                        startOfWeek,
                    );
                    return [...acc, ...(dim.tablesReferences || [dim.table])];
                },
                [],
            ),
            ...getFilterRulesFromGroup(filters.metrics).reduce<string[]>(
                (acc, filterRule) => {
                    const metric = getMetricFromId(
                        filterRule.target.fieldId,
                        explore,
                        compiledMetricQuery,
                    );
                    return [
                        ...acc,
                        ...(metric.tablesReferences || [metric.table]),
                    ];
                },
                [],
            ),
        ]);

        const tableCompiledSqlWhere =
            explore.tables[explore.baseTable].sqlWhere;

        const tableSqlWhere =
            explore.tables[explore.baseTable].uncompiledSqlWhere;

        const tableSqlWhereTableReferences = tableSqlWhere
            ? parseAllReferences(tableSqlWhere, explore.baseTable)
            : undefined;

        const tablesFromTableSqlWhereFilter = tableSqlWhereTableReferences
            ? tableSqlWhereTableReferences.map((ref) => ref.refTable)
            : [];

        const requiredFilterJoinedTables =
            explore.tables[explore.baseTable].requiredFilters
                ?.map((filter) => {
                    if (isJoinModelRequiredFilter(filter)) {
                        return filter.target.tableName;
                    }
                    return undefined;
                })
                .filter((s): s is string => Boolean(s)) || [];

        const joinedTables = new Set([
            ...selectedTables,
            ...getJoinedTables(explore, [...selectedTables]),
            ...tablesFromTableSqlWhereFilter,
            ...requiredFilterJoinedTables,
        ]);

        const sqlJoins = explore.joinedTables
            .filter((join) => joinedTables.has(join.table) || join.always)
            .map((join) => {
                const joinTable = replaceUserAttributesRaw(
                    explore.tables[join.table].sqlTable,
                    intrinsicUserAttributes,
                    userAttributes,
                );
                const joinType = getJoinType(join.type);

                const alias = join.table;
                const parsedSqlOn = replaceUserAttributesAsStrings(
                    join.compiledSqlOn,
                    intrinsicUserAttributes,
                    userAttributes,
                    warehouseClient,
                );
                return `${joinType} ${joinTable} AS ${fieldQuoteChar}${alias}${fieldQuoteChar}\n  ON ${parsedSqlOn}`;
            })
            .join('\n');

        const filteredMetricSelects = getFilterRulesFromGroup(
            filters.metrics,
        ).reduce<string[]>((acc, filter) => {
            const metricInSelect = metrics.find(
                (metric) => metric === filter.target.fieldId,
            );
            if (metricInSelect !== undefined) {
                return acc;
            }
            const alias = filter.target.fieldId;
            const metric = getMetricFromId(
                filter.target.fieldId,
                explore,
                compiledMetricQuery,
            );
            const renderedSql = `  ${metric.compiledSql} AS ${fieldQuoteChar}${alias}${fieldQuoteChar}`;
            return acc.includes(renderedSql) ? acc : [...acc, renderedSql];
        }, []);

        const sqlSelect = `SELECT\n${[
            ...dimensionSelects,
            ...(customBinDimensionSql?.selects || []),
            ...(customSqlDimensionSql?.selects || []),
            ...metricSelects,
            ...filteredMetricSelects,
        ].join(',\n')}`;

        const groups = [
            ...(dimensionSelects.length > 0 ? dimensionSelects : []),
            ...(customBinDimensionSql?.selects || []),
            ...(customSqlDimensionSql?.selects || []),
        ];
        const sqlGroupBy =
            groups.length > 0
                ? `GROUP BY ${groups.map((val, i) => i + 1).join(',')}`
                : '';

        const compiledDimensions = getDimensions(explore);

        let shouldWrapQueryCTE = false;
        const fieldOrders = sorts.map((sort) => {
            if (
                compiledCustomDimensions &&
                compiledCustomDimensions.find(
                    (customDimension) =>
                        getItemId(customDimension) === sort.fieldId &&
                        isCustomBinDimension(customDimension),
                )
            ) {
                // Custom dimensions will have a separate `select` for ordering,
                // that returns the min value (int) of the bin, rather than a string,
                // so we can use it for sorting
                return `${fieldQuoteChar}${
                    sort.fieldId
                }_order${fieldQuoteChar}${sort.descending ? ' DESC' : ''}`;
            }
            const sortedDimension = compiledDimensions.find(
                (d) => getItemId(d) === sort.fieldId,
            );

            if (
                sortedDimension &&
                sortedDimension.timeInterval === TimeFrames.MONTH_NAME
            ) {
                shouldWrapQueryCTE = true;

                return sortMonthName(
                    sortedDimension,
                    getFieldQuoteChar(warehouseClient.credentials.type),
                    sort.descending,
                );
            }
            if (
                sortedDimension &&
                sortedDimension.timeInterval === TimeFrames.DAY_OF_WEEK_NAME
            ) {
                // in BigQuery, we cannot use a function in the ORDER BY clause that references a column that is not aggregated or grouped
                // so we need to wrap the query in a CTE to allow us to reference the column in the ORDER BY clause
                // for consistency, we do it for all warehouses
                shouldWrapQueryCTE = true;
                return sortDayOfWeekName(
                    sortedDimension,
                    startOfWeek,
                    getFieldQuoteChar(warehouseClient.credentials.type),
                    sort.descending,
                );
            }
            return `${fieldQuoteChar}${sort.fieldId}${fieldQuoteChar}${
                sort.descending ? ' DESC' : ''
            }`;
        });

        const sqlOrderBy =
            fieldOrders.length > 0 ? `ORDER BY ${fieldOrders.join(', ')}` : '';
        const sqlFilterRule = (filter: FilterRule, fieldType?: FieldType) => {
            if (!fieldType) {
                const field =
                    compiledMetricQuery.compiledTableCalculations?.find(
                        (tc) => getItemId(tc) === filter.target.fieldId,
                    );
                return renderTableCalculationFilterRuleSql(
                    filter,
                    field,
                    fieldQuoteChar,
                    stringQuoteChar,
                    escapeStringQuoteChar,
                    adapterType,
                    startOfWeek,
                    timezone,
                );
            }

            const field =
                fieldType === FieldType.DIMENSION
                    ? [
                          ...getDimensions(explore),
                          ...compiledCustomDimensions.filter(
                              isCompiledCustomSqlDimension,
                          ),
                      ].find((d) => getItemId(d) === filter.target.fieldId)
                    : getMetricFromId(
                          filter.target.fieldId,
                          explore,
                          compiledMetricQuery,
                      );
            if (!field) {
                throw new FieldReferenceError(
                    `Filter has a reference to an unknown ${fieldType}: ${filter.target.fieldId}`,
                );
            }

            return renderFilterRuleSqlFromField(
                filter,
                field,
                fieldQuoteChar,
                stringQuoteChar,
                escapeStringQuoteChar,
                startOfWeek,
                adapterType,
                timezone,
            );
        };

        const getNestedFilterSQLFromGroup = (
            filterGroup: FilterGroup | undefined,
            fieldType?: FieldType,
        ): string | undefined => {
            if (filterGroup) {
                const operator = isAndFilterGroup(filterGroup) ? 'AND' : 'OR';
                const items = isAndFilterGroup(filterGroup)
                    ? filterGroup.and
                    : filterGroup.or;
                if (items.length === 0) return undefined;
                const filterRules: string[] = items.reduce<string[]>(
                    (sum, item) => {
                        const filterSql: string | undefined = isFilterGroup(
                            item,
                        )
                            ? getNestedFilterSQLFromGroup(item, fieldType)
                            : `(\n  ${sqlFilterRule(item, fieldType)}\n)`;
                        return filterSql ? [...sum, filterSql] : sum;
                    },
                    [],
                );
                return filterRules.length > 0
                    ? `(${filterRules.join(` ${operator} `)})`
                    : undefined;
            }
            return undefined;
        };

        const getNestedDimensionFilterSQLFromModelFilters = (
            table: CompiledTable,
            dimensionsFilterGroup: FilterGroup | undefined,
        ): string | undefined => {
            // We only force required filters that are not explicitly set to false
            // requiredFilters with required:false will be added on the UI, but not enforced on the backend
            const modelFilterRules: MetricFilterRule[] | undefined =
                table.requiredFilters?.filter(
                    (filter) => filter.required !== false,
                );

            if (!modelFilterRules) return undefined;

            const reducedRules: string[] = modelFilterRules.reduce<string[]>(
                (acc, filter) => {
                    let dimension: CompiledDimension | undefined;

                    // This function already takes care of falling back to the base table if the fieldRef doesn't have 2 parts (falls back to base table name)
                    const filterRule =
                        createFilterRuleFromModelRequiredFilterRule(
                            filter,
                            table.name,
                        );

                    if (isJoinModelRequiredFilter(filter)) {
                        const joinedTable =
                            explore.tables[filter.target.tableName];

                        if (joinedTable) {
                            dimension = Object.values(
                                joinedTable.dimensions,
                            ).find(
                                (d) =>
                                    getItemId(d) === filterRule.target.fieldId,
                            );
                        }
                    } else {
                        dimension = Object.values(table.dimensions).find(
                            (tc) => getItemId(tc) === filterRule.target.fieldId,
                        );
                    }

                    if (!dimension) return acc;

                    if (
                        isFilterRuleInQuery(
                            dimension,
                            filterRule,
                            dimensionsFilterGroup,
                        )
                    )
                        return acc;

                    const filterString = `( ${sqlFilterRule(
                        filterRule,
                        FieldType.DIMENSION,
                    )} )`;
                    return [...acc, filterString];
                },
                [],
            );

            return reducedRules.join(' AND ');
        };

        const requiredDimensionFilterSql =
            getNestedDimensionFilterSQLFromModelFilters(
                explore.tables[explore.baseTable],
                filters.dimensions,
            );

        const tableSqlWhereWithReplacedAttributes = tableCompiledSqlWhere
            ? [
                  replaceUserAttributesAsStrings(
                      tableCompiledSqlWhere,
                      intrinsicUserAttributes,
                      userAttributes,
                      warehouseClient,
                  ),
              ]
            : [];

        const nestedFilterSql = getNestedFilterSQLFromGroup(
            filters.dimensions,
            FieldType.DIMENSION,
        );
        const requiredFiltersWhere = requiredDimensionFilterSql
            ? [requiredDimensionFilterSql]
            : [];
        const nestedFilterWhere = nestedFilterSql ? [nestedFilterSql] : [];
        const allSqlFilters = [
            ...tableSqlWhereWithReplacedAttributes,
            ...nestedFilterWhere,
            ...requiredFiltersWhere,
        ];

        const sqlWhere =
            allSqlFilters.length > 0
                ? `WHERE ${allSqlFilters.join(' AND ')}`
                : '';

        const whereMetricFilters = getNestedFilterSQLFromGroup(
            filters.metrics,
            FieldType.METRIC,
        );

        const tableCalculationFilters = getNestedFilterSQLFromGroup(
            filters.tableCalculations,
        );

        const sqlLimit = `LIMIT ${limit}`;

        if (
            compiledMetricQuery.compiledTableCalculations.length > 0 ||
            whereMetricFilters ||
            shouldWrapQueryCTE
        ) {
            const cteSql = [
                sqlSelect,
                sqlFrom,
                sqlJoins,
                customBinDimensionSql && customBinDimensionSql.joins.length > 0
                    ? `CROSS JOIN ${customBinDimensionSql.joins.join(',\n')}`
                    : undefined,
                sqlWhere,
                sqlGroupBy,
            ]
                .filter((l) => l !== undefined)
                .join('\n');
            const cteName = 'metrics';
            const ctes = [
                ...(customBinDimensionSql?.ctes || []),
                `${cteName} AS (\n${cteSql}\n)`,
            ];
            const tableCalculationSelects =
                compiledMetricQuery.compiledTableCalculations.map(
                    (tableCalculation) => {
                        const alias = tableCalculation.name;
                        return `  ${tableCalculation.compiledSql} AS ${fieldQuoteChar}${alias}${fieldQuoteChar}`;
                    },
                );
            const finalSelect = `SELECT\n${[
                '  *',
                ...tableCalculationSelects,
            ].join(',\n')}`;
            const finalFrom = `FROM ${cteName}`;
            const finalSqlWhere = whereMetricFilters
                ? `WHERE ${whereMetricFilters}`
                : '';
            const secondQuery = [finalSelect, finalFrom, finalSqlWhere].join(
                '\n',
            );

            let finalQuery = secondQuery;
            if (tableCalculationFilters) {
                const queryResultCteName = 'table_calculations';
                ctes.push(`${queryResultCteName} AS (\n${secondQuery}\n)`);

                finalQuery = `SELECT *
                              FROM ${queryResultCteName}`;

                if (tableCalculationFilters)
                    finalQuery += ` WHERE ${tableCalculationFilters}`;
            }
            const cte = `WITH ${ctes.join(',\n')}`;

            return {
                query: [cte, finalQuery, sqlOrderBy, sqlLimit].join('\n'),
                fields,
            };
        }

        const metricQuerySql = [
            customBinDimensionSql && customBinDimensionSql.ctes.length > 0
                ? `WITH ${customBinDimensionSql.ctes.join(',\n')}`
                : undefined,
            sqlSelect,
            sqlFrom,
            sqlJoins,
            customBinDimensionSql && customBinDimensionSql.joins.length > 0
                ? `CROSS JOIN ${customBinDimensionSql.joins.join(',\n')}`
                : undefined,
            sqlWhere,
            sqlGroupBy,
            sqlOrderBy,
            sqlLimit,
        ]
            .filter((l) => l !== undefined)
            .join('\n');

        return {
            query: metricQuerySql,
            fields,
        };
    });

type ReferenceObject = { type: DimensionType; sql: string };
export type ReferenceMap = Record<string, ReferenceObject> | undefined;
type From = { name: string; sql?: string };

export class QueryBuilder {
    // Column references, to be used in select, filters, etc
    private readonly referenceMap: ReferenceMap;

    // Select values are references
    private readonly select: string[];

    private readonly from: From;

    private readonly filters: FilterGroup | undefined;

    constructor(
        args: {
            referenceMap: ReferenceMap;
            select: string[];
            from: From;
            filters?: FilterGroup;
        },
        private config: {
            fieldQuoteChar: string;
            stringQuoteChar: string;
            escapeStringQuoteChar: string;
            startOfWeek: WeekDay | null | undefined;
            adapterType: SupportedDbtAdapter;
            timezone?: string;
        },
    ) {
        this.select = args.select;
        this.from = args.from;
        this.filters = args.filters;
        this.referenceMap = args.referenceMap;
    }

    private quotedName(value: string) {
        return `${this.config.fieldQuoteChar}${value}${this.config.fieldQuoteChar}`;
    }

    private getReference(reference: string): ReferenceObject {
        const referenceObject = this.referenceMap?.[reference];
        if (!referenceObject) {
            throw new FieldReferenceError(`Unknown reference: ${reference}`);
        }
        return referenceObject;
    }

    private selectsToSql(): string | undefined {
        let selectSQL = '*';
        if (this.select.length > 0) {
            selectSQL = this.select
                .map((reference) => {
                    const referenceObject = this.getReference(reference);
                    return `${referenceObject.sql} AS ${this.quotedName(
                        reference,
                    )}`;
                })
                .join(',\n');
        }
        return `SELECT\n${selectSQL}`;
    }

    private fromToSql(): string {
        return `FROM ${
            this.from.sql ? `(\n${this.from.sql}\n) AS ` : ''
        }${this.quotedName(this.from.name)}`;
    }

    private filtersToSql() {
        // Recursive function to convert filters to SQL
        const getNestedFilterSQLFromGroup = (
            filterGroup: FilterGroup | undefined,
        ): string | undefined => {
            if (filterGroup) {
                const operator = isAndFilterGroup(filterGroup) ? 'AND' : 'OR';
                const items = isAndFilterGroup(filterGroup)
                    ? filterGroup.and
                    : filterGroup.or;
                if (items.length === 0) return undefined;
                const filterRules: string[] = items.reduce<string[]>(
                    (sum, item) => {
                        // Handle nested filters
                        if (isFilterGroup(item)) {
                            const nestedFilterSql =
                                getNestedFilterSQLFromGroup(item);
                            return nestedFilterSql
                                ? [...sum, nestedFilterSql]
                                : sum;
                        }
                        // Handle filter rule
                        const reference = this.getReference(
                            item.target.fieldId,
                        );
                        const filterSQl = `(\n${renderFilterRuleSql(
                            item,
                            reference.type,
                            reference.sql,
                            this.config.stringQuoteChar,
                            this.config.escapeStringQuoteChar,
                            this.config.startOfWeek,
                            this.config.adapterType,
                            this.config.timezone,
                        )}\n)`;
                        return [...sum, filterSQl];
                    },
                    [],
                );
                return filterRules.length > 0
                    ? `(${filterRules.join(` ${operator} `)})`
                    : undefined;
            }
            return undefined;
        };

        const filtersSql = getNestedFilterSQLFromGroup(this.filters);
        if (filtersSql) {
            return `WHERE ${filtersSql}`;
        }
        return undefined;
    }

    toSql(): string {
        // Combine all parts of the query
        return [this.selectsToSql(), this.fromToSql(), this.filtersToSql()]
            .filter((l) => l !== undefined)
            .join('\n');
    }
}
