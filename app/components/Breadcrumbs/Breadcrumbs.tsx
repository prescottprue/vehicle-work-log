export interface BreadcrumbsProps {
  children: React.ReactNode
}

// export function Breadcrumbs({ children }: BreadcrumbsProps) {
//   return (
//   <nav className="flex px-5 py-3 text-gray-700 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700 max-w-sm my-3" aria-label="Breadcrumb">
//     <ol className="inline-flex items-center space-x-1 md:space-x-2 rtl:space-x-reverse">
//       <li className="inline-flex items-center">
//         <NavLink to="/" className="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600 dark:text-gray-400 dark:hover:text-white">
//           <svg className="w-3 h-3 me-2.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
//             <path d="m19.707 9.293-2-2-7-7a1 1 0 0 0-1.414 0l-7 7-2 2a1 1 0 0 0 1.414 1.414L2 10.414V18a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7.586l.293.293a1 1 0 0 0 1.414-1.414Z"/>
//           </svg>
//           Home
//         </NavLink>
//       </li>
//       {children}
//     </ol>
//   </nav>
//   )
// }

export function Breadcrumbs({ children }: BreadcrumbsProps) {
  return (
    <ol className="flex items-center whitespace-nowrap p-2 border-gray-200 dark:border-neutral-700">
      <li className="inline-flex items-center">
        <a className="flex items-center text-sm text-gray-500 hover:text-blue-600 focus:outline-none focus:text-blue-600 dark:text-neutral-500 dark:hover:text-blue-500 dark:focus:text-blue-500" href="/">
          <svg className="flex-shrink-0 me-3 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          Home
        </a>
        <svg className="flex-shrink-0 mx-2 overflow-visible size-4 text-gray-400 dark:text-neutral-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6"></path>
        </svg>
      </li>
      {children}
    </ol>
  )
}