import { NavLink } from "@remix-run/react";

export interface BreadcrumbProps {
  label: string,
  to: string
  lastChild?: boolean
}

// export function Breadcrumb({ label, to }: BreadcrumbProps) {
//   return (
//     <li>
//     <div className="flex items-center">
//       <svg className="rtl:rotate-180 block w-3 h-3 mx-1 text-gray-400 " aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
//         <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 9 4-4-4-4"/>
//       </svg>
//       <NavLink to={to} className="ms-1 text-sm font-medium text-gray-700 hover:text-blue-600 md:ms-2 dark:text-gray-400 dark:hover:text-white">{label}</NavLink>
//     </div>
//   </li>
//   )
// }

export function Breadcrumb({ label, to, lastChild }: BreadcrumbProps) {
  return (
    <li className="inline-flex items-center">
    <NavLink to={to} className="flex items-center text-sm text-gray-500 hover:text-blue-600 focus:outline-none focus:text-blue-600 dark:text-neutral-500 dark:hover:text-blue-500 dark:focus:text-blue-500">
      <svg className="flex-shrink-0 me-3 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="7" x="14" y="3" rx="1"></rect>
        <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"></path>
      </svg>
      {label}
      {
        !lastChild
        ? (
          <svg className="flex-shrink-0 mx-2 overflow-visible size-4 text-gray-400 dark:text-neutral-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        )
        : null
      }
    </NavLink>
  </li>
  )
}