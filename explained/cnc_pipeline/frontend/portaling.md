# UI Portaling to AppNavbar

This document explains the dynamic UI injection (portaling) mechanism used to populate the application's top navigation bar from the CNC Pipeline page.

## 1. Goal
To keep the UI clean while providing page-specific controls (Algorithm selector, job status, time estimations) in a fixed global location (the navbar).

## 2. Global Portal Anchor (`AppNavbar.tsx`)
In the main navbar component (`AppNavbar.tsx`), a special container is defined that only renders when the user is on a CNC-related route:

```tsx
// AppNavbar.tsx
{isCncPipeline && (
  <div id="cnc-navbar-portal" className="flex flex-1 items-center justify-between gap-4 overflow-x-auto" />
)}
```

This `div` with the ID `cnc-navbar-portal` acts as a destination for React Portals.

## 3. Dynamic Identification (`CNCPipelinePage.tsx`)
The `CNCPipelinePage` uses a combination of `useState` and `useEffect` to find this DOM element:

```tsx
// CNCPipelinePage.tsx
const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

useEffect(() => {
  const el = document.getElementById("cnc-navbar-portal")
  if (el) {
    setPortalNode(el)
  } else {
    // If navbar is not ready yet, observe it
    const observer = new MutationObserver(() => {
      const node = document.getElementById("cnc-navbar-portal")
      if (node) {
        setPortalNode(node)
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }
}, [])
```

The use of `MutationObserver` ensures that even if the page finishes loading before the sidebar/navbar components are fully mounted, the connection is still established.

## 4. Content Injection
Once the `portalNode` is identified, the page uses `createPortal` to inject a rich set of controls directly into the navbar:

- **Backend Status**: A health check indicator.
- **Algorithm Selector**: A dropdown to change the sequence optimization strategy.
- **Job Analysis**: Filename, scenario (e.g., FREZ → CUT), tool sequence, contour counts, and estimated time.
- **Action Buttons**: "Generate another" and "Generate NC program".

This allows the user to monitor progress and change settings without scrolling or leaving the primary workspace.
