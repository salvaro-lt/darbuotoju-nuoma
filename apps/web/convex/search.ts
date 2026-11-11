// Global search (Cmd+K): each module contributes a provider; results are filtered
// by the caller's permissions on the server. Add a module's provider here.
import { financeSearch } from "@digimuza/system-core/finance"
import { defineSearch } from "@digimuza/system-core/search"
import { system } from "./system"

export const { search } = defineSearch(system, { providers: [financeSearch] }).functions
