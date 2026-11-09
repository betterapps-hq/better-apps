import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@buildkitgg/shadcn-baseui-kit"
import {
  createTable,
  flexRender,
  type Column,
  type RowData,
  type TableOptions,
  type TableState,
  type Table as TableInstance
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CirclePlusIcon
} from "lucide-react"
import { useState, type ReactNode } from "react"

// Table parts in the style of tablecn, built from the kit's components on TanStack Table.

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes for the column's header and cells, such as `numeric` or `optional`. */
    className?: string
  }
}

/**
 * A TanStack table that keeps its own state for whatever `options.state` leaves out, as `useReactTable` does. The table
 * is one object changed in place, so this hook and every component that reads it opt out of the React Compiler.
 */
export function useDataTable<Row>(options: Omit<TableOptions<Row>, "onStateChange" | "renderFallbackValue">) {
  "use no memo"
  const [table] = useState(() =>
    createTable<Row>({ state: {}, onStateChange: () => undefined, renderFallbackValue: null, ...options })
  )
  const [state, setState] = useState<TableState>(() => table.initialState)
  table.setOptions((previous) => ({
    ...previous,
    ...options,
    state: { ...state, ...options.state },
    onStateChange: setState
  }))
  return table
}

const ariaSort = { asc: "ascending", desc: "descending" } as const

interface DataTableProps<Row> {
  table: TableInstance<Row>
  /** Says what the table shows, for screen readers. */
  caption: string
  /** Shown in place of the rows when none match. */
  empty: ReactNode
}

/** A table's headers and rows. Columns can set `meta.className`, such as `numeric` or `optional`. */
export function DataTable<Row>({ table, caption, empty }: DataTableProps<Row>) {
  // These read TanStack Table's table and column objects, which change in place, so the React Compiler skips them.
  "use no memo"
  const rows = table.getRowModel().rows
  return (
    <div className="data-table">
      <Table>
        <TableCaption className="visually-hidden">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    className={header.column.columnDef.meta?.className}
                    aria-sort={sorted ? ariaSort[sorted] : undefined}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={table.getVisibleLeafColumns().length}>{empty}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

const sortIcons = { asc: <ArrowUpIcon />, desc: <ArrowDownIcon />, none: <ChevronsUpDownIcon /> }

/** A column's title, as a button that sorts by it when the column can be sorted. */
export function DataTableColumnHeader<Row>({ column, title }: { column: Column<Row>; title: string }) {
  // These read TanStack Table's table and column objects, which change in place, so the React Compiler skips them.
  "use no memo"
  if (!column.getCanSort()) {
    return title
  }
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="column-sort"
      onClick={column.getToggleSortingHandler()}
      aria-label={`${title}, sort ${column.getNextSortingOrder() === "desc" ? "descending" : "ascending"}`}
    >
      {title}
      {sortIcons[sorted || "none"]}
    </Button>
  )
}

export interface FilterOption {
  value: string
  label: string
}

interface FacetedFilterProps<Row> {
  column: Column<Row>
  title: string
  options: readonly FilterOption[]
}

/**
 * A button that filters a column by several of its values, with how many rows have each among those the other filters
 * leave. The values picked show on the button.
 */
export function DataTableFacetedFilter<Row>({ column, title, options }: FacetedFilterProps<Row>) {
  // These read TanStack Table's table and column objects, which change in place, so the React Compiler skips them.
  "use no memo"
  const counts = column.getFacetedUniqueValues()
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? [])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    column.setFilterValue(next.size > 0 ? [...next] : undefined)
  }

  const picked = options.filter((option) => selected.has(option.value))

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="faceted-trigger"
            aria-label={picked.length > 0 ? `${title}: ${picked.map((option) => option.label).join(", ")}` : title}
          />
        }
      >
        <CirclePlusIcon />
        {title}
        {picked.length > 0 && (
          <>
            <Separator orientation="vertical" className="faceted-separator" />
            {picked.length > 2 ? (
              <Badge variant="secondary">{picked.length} selected</Badge>
            ) : (
              picked.map((option) => (
                <Badge key={option.value} variant="secondary">
                  {option.label}
                </Badge>
              ))
            )}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="faceted-popover">
        <Command>
          <CommandInput placeholder={title} aria-label={`Search ${title.toLowerCase()} options`} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggle(option.value)}
                    aria-checked={isSelected}
                  >
                    <span className="faceted-check" data-checked={isSelected ? "" : undefined} aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>{option.label}</span>
                    <span className="faceted-count">{counts.get(option.value) ?? 0}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem className="faceted-clear" onSelect={() => column.setFilterValue(undefined)}>
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const pageSizes = [10, 20, 50]

/** How many rows show and which page, with buttons to move between pages. */
export function DataTablePagination<Row>({ table, noun }: { table: TableInstance<Row>; noun: [string, string] }) {
  // These read TanStack Table's table and column objects, which change in place, so the React Compiler skips them.
  "use no memo"
  const { pageIndex, pageSize } = table.getState().pagination
  const total = table.getFilteredRowModel().rows.length
  const first = total === 0 ? 0 : pageIndex * pageSize + 1
  const last = Math.min(total, (pageIndex + 1) * pageSize)
  const word = total === 1 ? noun[0] : noun[1]
  return (
    <div className="data-table-pager">
      <p className="muted">{total === 0 ? `No ${noun[1]}` : `${first} to ${last} of ${total} ${word}`}</p>
      <div className="data-table-pager-controls">
        <label className="data-table-page-size">
          <span>Rows per page</span>
          <NativeSelect
            size="sm"
            value={String(pageSize)}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {pageSizes.map((size) => (
              <NativeSelectOption key={size} value={String(size)}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <span className="muted">
          Page {Math.min(pageIndex + 1, Math.max(table.getPageCount(), 1))} of {Math.max(table.getPageCount(), 1)}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}
