import React, { useState } from 'react'
import { Skeleton } from '../ui/skeleton'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [didError, setDidError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const handleError = () => {
    setDidError(true)
    setIsLoading(false)
  }

  const handleLoad = () => {
    setIsLoading(false)
  }

  const { src, alt, style, className, ...rest } = props

  return (
    <div className="relative w-full h-full">
      {isLoading && !didError && (
        <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
      )}
      
      {didError ? (
        <div
          className={`flex items-center justify-center bg-gray-100 text-center align-middle w-full h-full ${className ?? ''}`}
          style={style}
        >
          <img src={ERROR_IMG_SRC} alt="Error loading image" {...rest} data-original-url={src} />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`${className ?? ''} transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          style={style}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          {...rest}
        />
      )}
    </div>
  )
}
